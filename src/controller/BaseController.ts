import { FetchService } from "@/index";
import {
  AbortInterceptor,
  ETagCacheInterceptor,
  LoggingInterceptor,
} from "@/interceptors";
import type { FetchInterceptor } from "@/index";

export abstract class BaseController {
  protected readonly api: FetchService;
  private readonly interceptorIds = new Set<string>();

  constructor(api: FetchService) {
    this.api = api;
  }

  /**
   * Gets the `FetchService` instance related to this controller.
   * @returns The `FetchService` instance of this controller.
   */
  public getFetchService(): FetchService {
    return this.api;
  }

  /**
   * Adds ETag cache middleware interceptor.
   * @param root - The root URL pattern the interceptor apply to.
   * @returns The created `ETagCacheInterceptor` instance.
   */
  public enableCache(root: string): ETagCacheInterceptor {
    const interceptor = new ETagCacheInterceptor(createRootUrlPattern(root));
    return this.registerInterceptor(interceptor);
  }

  /**
   * Adds AbortController middleware interceptor.
   * @param root - The root URL pattern the interceptor apply to.
   * @returns The created `AbortInterceptor` instance.
   */
  public enableAbortController(root: string): AbortInterceptor {
    const interceptor = new AbortInterceptor(createRootUrlPattern(root));
    return this.registerInterceptor(interceptor);
  }

  /**
   * Adds logging middleware interceptor.
   * @param root - The root URL pattern the interceptor apply to.
   * @returns The created `LoggingInterceptor` instance.
   */
  public enableLogging(root: string): LoggingInterceptor {
    const interceptor = new LoggingInterceptor(createRootUrlPattern(root));
    return this.registerInterceptor(interceptor);
  }

  /**
   * Removes interceptors registered by this controller.
   */
  public dispose(): void {
    for (const id of this.interceptorIds) {
      this.api.removeInterceptor(id);
    }
    this.interceptorIds.clear();
  }

  private registerInterceptor<T extends FetchInterceptor>(interceptor: T): T {
    this.interceptorIds.add(this.api.addInterceptor(interceptor));
    return interceptor;
  }
}

/**
 * Converts the root string into a regex expression.
 * @param root - The root string.
 * @returns Returns a RegExp based on the root string.
 */
function createRootUrlPattern(root: string): RegExp {
  const normalizedRoot = root.replace(/^\/+|\/+$/g, "");
  if (!normalizedRoot) {
    throw new TypeError("Interceptor root must not be empty.");
  }

  const escapedRoot = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|/)${escapedRoot}(?:/|\\?|#|$)`);
}
