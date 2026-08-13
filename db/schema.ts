import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pairingCodes = sqliteTable(
  "pairing_codes",
  {
    code: text("code").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("pairing_codes_owner_idx").on(table.ownerEmail),
    index("pairing_codes_expires_idx").on(table.expiresAt),
  ],
);

export const pairingRateLimits = sqliteTable("pairing_rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("android"),
    appVersion: text("app_version").notNull().default("1.0.0"),
    tokenHash: text("token_hash").notNull(),
    batteryLevel: integer("battery_level"),
    screenWidth: integer("screen_width"),
    screenHeight: integer("screen_height"),
    lastSeenAt: integer("last_seen_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("devices_owner_idx").on(table.ownerEmail),
    index("devices_last_seen_idx").on(table.lastSeenAt),
  ],
);

export const remoteSessions = sqliteTable(
  "remote_sessions",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    deviceId: text("device_id").notNull(),
    state: text("state").notNull(),
    offerType: text("offer_type"),
    offerSdp: text("offer_sdp"),
    answerType: text("answer_type"),
    answerSdp: text("answer_sdp"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("remote_sessions_owner_idx").on(table.ownerEmail),
    index("remote_sessions_device_state_idx").on(table.deviceId, table.state),
    index("remote_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const remoteSessionCandidates = sqliteTable(
  "remote_session_candidates",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    sender: text("sender").notNull(),
    candidate: text("candidate").notNull(),
    sdpMid: text("sdp_mid"),
    sdpMLineIndex: integer("sdp_m_line_index"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("remote_candidates_session_sender_idx").on(
      table.sessionId,
      table.sender,
      table.createdAt,
    ),
  ],
);
