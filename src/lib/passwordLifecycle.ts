export type AppMetadata = Record<string, unknown>;

export function completePasswordChangeMetadata(appMetadata: AppMetadata = {}) {
  return {
    ...appMetadata,
    must_change_password: false,
    temporary_password_set_at: null,
  };
}
