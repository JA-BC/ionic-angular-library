import { NavigationCancel, NavigationEnd, NavigationError } from '@angular/router';
import type { Router } from '@angular/router';
import { filter, take } from 'rxjs';

interface LoginExchange<Identity, Result> {
  readonly identity: Identity;
  readonly promise: Promise<Result>;
  handoff: (() => boolean) | null;
  settledAt: number | null;
}

/** Shares an in-flight login and hands its startup result to authorization exactly once. */
export class KitAuthLoginExchange<Identity, Result> {
  #startedFor: Identity | undefined;
  #exchange: LoginExchange<Identity, Result> | null = null;

  /** Start once per signed-in identity; discard an unconsumed result when its navigation ends. */
  preload(identity: Identity, request: () => Promise<Result>, isCurrent: () => boolean): (() => void) | undefined {
    if (this.#startedFor === identity) return undefined;
    const exchange = this.#start(identity, request, isCurrent);
    void exchange.promise.catch(() => undefined);
    return () => {
      if (this.#exchange === exchange) this.clear();
    };
  }

  /** Consume a current startup result, share pending work, or perform a fresh login. */
  run(identity: Identity, request: () => Promise<Result>): Promise<Result> {
    const exchange = this.#exchange;
    if (
      exchange &&
      exchange.identity === identity &&
      (!exchange.handoff || (exchange.handoff() && (exchange.settledAt === null || Date.now() - exchange.settledAt < 30_000)))
    ) {
      exchange.handoff = null;
      if (exchange.settledAt !== null) this.#exchange = null;
      return exchange.promise;
    }
    return this.#start(identity, request, null).promise;
  }

  /** Forget startup state on sign-out; a later sign-in may preload again. */
  clear(): void {
    this.#exchange = null;
    this.#startedFor = undefined;
  }

  #start(identity: Identity, request: () => Promise<Result>, handoff: (() => boolean) | null): LoginExchange<Identity, Result> {
    const exchange: LoginExchange<Identity, Result> = {
      identity,
      handoff,
      settledAt: null,
      promise: request().finally(() => {
        exchange.settledAt = Date.now();
        if (!exchange.handoff && this.#exchange === exchange) this.#exchange = null;
      }),
    };
    this.#startedFor = identity;
    this.#exchange = exchange;
    return exchange;
  }
}

/** Bind an optional login preload to the active navigation and return cleanup for initialization failure. */
export function kitPreloadAuthLoginForNavigation(
  router: Pick<Router, 'currentNavigation' | 'events'>,
  preload: (isCurrent: () => boolean) => (() => void) | undefined,
): () => void {
  const navigation = router.currentNavigation();
  const cancel = navigation ? preload(() => router.currentNavigation() === navigation) : undefined;
  const subscription = cancel
    ? router.events
        .pipe(
          filter(
            (event) =>
              (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) &&
              event.id === navigation?.id,
          ),
          take(1),
        )
        .subscribe(() => cancel())
    : undefined;
  return () => {
    subscription?.unsubscribe();
    cancel?.();
  };
}
