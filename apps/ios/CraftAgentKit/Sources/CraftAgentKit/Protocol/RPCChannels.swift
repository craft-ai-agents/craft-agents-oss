import Foundation

/// Mirrors the MVP subset of `RPC_CHANNELS` in `packages/shared/src/protocol/channels.ts`.
/// These are wire-format string constants — the stable API contract with the server.
/// Add new nested enums here as later phases need more channels; do not rename
/// existing raw values without a matching server-side change.
public enum RPCChannels {
    public enum Server {
        public static let getWorkspaces = "server:getWorkspaces"
        public static let getStatus = "server:getStatus"
        public static let getHealth = "server:getHealth"
    }

    public enum Sessions {
        public static let get = "sessions:get"
        public static let getMessages = "sessions:getMessages"
        public static let sendMessage = "sessions:sendMessage"
        public static let create = "sessions:create"
        public static let respondToPermission = "sessions:respondToPermission"
        public static let getUnreadSummary = "sessions:getUnreadSummary"
        public static let markAllRead = "sessions:markAllRead"
        /// Note the singular "session" prefix — this one channel name does not
        /// follow the "sessions:" pattern used by the rest of this namespace.
        public static let event = "session:event"
    }

    public enum Statuses {
        public static let list = "statuses:list"
    }

    public enum Labels {
        public static let list = "labels:list"
    }
}
