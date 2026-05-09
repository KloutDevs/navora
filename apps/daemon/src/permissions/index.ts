/**
 * Permissions module - Permission store and confirmation gate for daemon
 */

// Re-export permission store
export {
  SqlitePermissionStore,
  createPermissionStore,
  type PermissionStoreConfig,
  type PermissionCheck,
  type PermissionGrant,
  type ListedPermission,
} from "./permission-store";

// Re-export confirmation gate
export {
  ConfirmationGate,
  createConfirmationGate,
  type ConfirmationGateConfig,
  type ConfirmationRequest,
  type ConfirmationDecision,
  type PendingConfirmation,
} from "./confirmation-gate";