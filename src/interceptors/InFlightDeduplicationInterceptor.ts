import {
  AbstractFetchInterceptor,
  InterceptorFetchContext,
} from "@/Interceptor";
import { FetchRequest } from "ofetch";

interface PendingRequest {
  controller: AbortController;
  promise: Promise<Response>;
  settled: boolean;
  subscribers: number;
}

type ExtendedRequestOptions = RequestInit & {
  agent?: unknown;
  dispatcher?: unknown;
};

/**
 * Shares identical in-flight GET requests for callers with matching request options.
 *
 * Cancelling one caller only cancels that caller's wait. The shared network request is
 * aborted when all callers have cancelled.
 */
export class InFlightDeduplicationInterceptor extends AbstractFetchInterceptor {
  private readonly inFlight = new Map<string, PendingRequest>();
  private readonly identities = new WeakMap<object, number>();
  private readonly symbolIdentities = new Map<symbol, number>();
  private nextIdentity = 0;

  override onFetch({
    request,
    options,
    next,
  }: InterceptorFetchContext): Promise<Response> {
    const key = this.getRequestKey(request, options);
    if (key === undefined) return next(request, options);

    if (options.signal?.aborted) return next(request, options);

    let pending = this.inFlight.get(key);
    if (!pending) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(() =>
        next(request, { ...options, signal: controller.signal }),
      );
      pending = {
        controller,
        promise,
        settled: false,
        subscribers: 0,
      };
      this.inFlight.set(key, pending);

      const createdPending = pending;
      void promise.then(
        () => this.removePending(key, createdPending),
        () => this.removePending(key, createdPending),
      );
    }

    return this.subscribe(key, pending, options.signal);
  }

  private getRequestKey(
    request: FetchRequest,
    options: RequestInit,
  ): string | undefined {
    if (
      typeof request !== "string" ||
      (options.method ?? "GET").toUpperCase() !== "GET" ||
      options.body != null
    ) {
      return undefined;
    }

    const headers = Array.from(new Headers(options.headers).entries()).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const extendedOptions = options as ExtendedRequestOptions;

    return JSON.stringify([
      request,
      headers,
      options.credentials ?? null,
      options.mode ?? null,
      options.cache ?? null,
      options.redirect ?? null,
      options.referrer ?? null,
      options.referrerPolicy ?? null,
      options.integrity ?? null,
      options.keepalive ?? null,
      this.getIdentity(extendedOptions.dispatcher),
      this.getIdentity(extendedOptions.agent),
    ]);
  }

  private getIdentity(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    switch (typeof value) {
      case "string":
      case "number":
      case "boolean":
      case "bigint":
        return `${typeof value}:${value}`;
      case "symbol": {
        let identity = this.symbolIdentities.get(value);
        if (identity === undefined) {
          identity = this.nextIdentity++;
          this.symbolIdentities.set(value, identity);
        }
        return `symbol:${identity}`;
      }
    }

    const reference = value;
    let identity = this.identities.get(reference);
    if (identity === undefined) {
      identity = this.nextIdentity++;
      this.identities.set(reference, identity);
    }
    return `reference:${identity}`;
  }

  private subscribe(
    key: string,
    pending: PendingRequest,
    signal?: AbortSignal | null,
  ): Promise<Response> {
    pending.subscribers++;

    return new Promise((resolve, reject) => {
      let active = true;

      const finish = (): boolean => {
        if (!active) return false;
        active = false;
        signal?.removeEventListener("abort", onAbort);
        pending.subscribers--;

        if (pending.subscribers === 0 && !pending.settled) {
          if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
          pending.controller.abort();
        }
        return true;
      };

      const onAbort = (): void => {
        if (finish()) reject(createAbortError(signal?.reason));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });

      pending.promise.then(
        (response) => {
          if (!active) return;
          try {
            const clone = response.clone();
            if (finish()) resolve(clone);
          } catch (error) {
            if (finish()) reject(toError(error, "The shared response failed."));
          }
        },
        (error: unknown) => {
          if (finish()) reject(toError(error, "The shared request failed."));
        },
      );
    });
  }

  private removePending(key: string, pending: PendingRequest): void {
    pending.settled = true;
    if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
  }
}

/**
 * Creates an abort error while preserving the original abort reason.
 * @param reason - The signal's abort reason, if provided.
 * @returns An abort error.
 */
function createAbortError(reason: unknown): Error {
  const error = new Error("The request was aborted.", { cause: reason });
  error.name = "AbortError";
  return error;
}

/**
 * Converts arbitrary rejection values into errors.
 * @param reason - The original rejection value.
 * @param message - The message used when the reason is not an error.
 * @returns An error suitable for rejecting a promise.
 */
function toError(reason: unknown, message: string): Error {
  if (reason instanceof Error) return reason;
  return new Error(message, { cause: reason });
}
