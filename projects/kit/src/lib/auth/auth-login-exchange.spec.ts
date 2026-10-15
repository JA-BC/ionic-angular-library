import { NavigationCancel, NavigationEnd, NavigationError } from '@angular/router';
import type { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KitAuthLoginExchange, kitPreloadAuthLoginForNavigation } from './auth-login-exchange';

describe('KitAuthLoginExchange', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shares pending work and performs fresh authorization after settlement', async () => {
    const exchange = new KitAuthLoginExchange<object, number>();
    const identity = {};
    let resolve!: (value: number) => void;
    const request = vi.fn(
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
    );
    exchange.preload(identity, request, () => true);
    const result = exchange.run(identity, request);
    expect(exchange.run(identity, request)).toBe(result);
    await undefined;
    expect(request).toHaveBeenCalledTimes(1);
    resolve(7);
    await expect(result).resolves.toBe(7);
    await expect(exchange.run(identity, async () => 8)).resolves.toBe(8);
  });

  it.each(['success', 'failure'])('hands a settled %s to authorization only once', async (outcome) => {
    const exchange = new KitAuthLoginExchange<object, number>();
    const identity = {};
    const error = new Error('offline');
    const request = vi.fn(async () => {
      if (outcome === 'success') return 7;
      throw error;
    });
    exchange.preload(identity, request, () => true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = exchange.run(identity, request);
    if (outcome === 'success') await expect(result).resolves.toBe(7);
    else await expect(result).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(exchange.run(identity, async () => 8)).resolves.toBe(8);
  });

  it.each(['navigation', 'age', 'identity'])('does not reuse a stale result after %s changes', async (reason) => {
    const exchange = new KitAuthLoginExchange<object, number>();
    const identity = {};
    let current = true;
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    exchange.preload(
      identity,
      async () => 7,
      () => current,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (reason === 'navigation') current = false;
    if (reason === 'age') now.mockReturnValue(31_000);
    await expect(exchange.run(reason === 'identity' ? {} : identity, async () => 8)).resolves.toBe(8);
  });

  it('clears sign-out state without an old completion discarding a replacement request', async () => {
    const exchange = new KitAuthLoginExchange<object, number>();
    const identity = {};
    let resolve!: (value: number) => void;
    exchange.preload(
      identity,
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
      () => true,
    );
    await undefined;
    exchange.clear();
    const request = vi.fn(async () => 8);
    expect(exchange.preload(identity, request, () => true)).toBeTypeOf('function');
    resolve(7);
    await expect(exchange.run(identity, request)).resolves.toBe(8);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('kitPreloadAuthLoginForNavigation', () => {
  it.each(['end', 'cancel', 'error'])('discards only the owning navigation on %s', (kind) => {
    const events = new Subject<NavigationEnd | NavigationCancel | NavigationError>();
    const navigation = { id: 1 };
    const router = { currentNavigation: () => navigation, events } as unknown as Pick<Router, 'currentNavigation' | 'events'>;
    const cancel = vi.fn();
    const preload = vi.fn(() => cancel);
    const cleanup = kitPreloadAuthLoginForNavigation(router, preload);
    events.next(new NavigationEnd(2, '/', '/'));
    expect(cancel).not.toHaveBeenCalled();
    events.next(
      kind === 'end'
        ? new NavigationEnd(1, '/', '/')
        : kind === 'cancel'
          ? new NavigationCancel(1, '/', 'cancelled')
          : new NavigationError(1, '/', new Error('failed')),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('cancels and unsubscribes when local initialization fails', () => {
    const events = new Subject<NavigationEnd>();
    const router = { currentNavigation: () => ({ id: 1 }), events } as unknown as Pick<Router, 'currentNavigation' | 'events'>;
    const cancel = vi.fn();
    const cleanup = kitPreloadAuthLoginForNavigation(router, () => cancel);
    cleanup();
    events.next(new NavigationEnd(1, '/', '/'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
