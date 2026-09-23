type TimeoutOptions = {
  timeoutMs?: number;
  message?: string;
};

export const DEFAULT_WRITE_TIMEOUT_MS = 15_000;

export async function withAbortTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  options: TimeoutOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await operation(controller.signal);
    if (controller.signal.aborted) {
      throw new Error(options.message || 'A operação demorou demais. Verifique sua conexão e tente novamente.');
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(options.message || 'A operação demorou demais. Verifique sua conexão e tente novamente.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function withPromiseTimeout<T>(
  operation: PromiseLike<T>,
  options: TimeoutOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(options.message || 'A operação demorou demais. Verifique sua conexão e tente novamente.')),
      timeoutMs
    );
  });

  try {
    return await Promise.race([Promise.resolve(operation), timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
