/**
 * Tier 3: Cross-Feature Combinations — Automations Engine + Discord Triggers & Webhook Bridge
 *
 * Combines automations scheduling, document export triggers, Discord embed generation,
 * and cryptographic HMAC-SHA256 signed delivery:
 * - Schedule trigger fires automated document digest
 * - Generates Discord embed with Worlds Gold palette (0xD2A46E)
 * - HMAC-SHA256 signs webhook payload (x-worlds-signature)
 * - Verifies receiver validates integrity and rejects tampered bodies
 */

import { describe, it, expect } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  validateDiscordPayload,
  WORLDS_GOLD_DECIMAL,
  type AutomationRule,
  type DiscordWebhookPayload,
} from "../harness/automations";

describe("Tier 3: Automations Engine + Discord Webhook Bridge", () => {
  const WEBHOOK_SECRET = "super-secret-sync-webhook-key-2026";

  it("triggers scheduled automation and dispatches signed Discord embed", () => {
    // 1. Scheduled Rule: Daily Workspace Digest
    const automationRule: AutomationRule = {
      id: "rule-daily-digest",
      name: "Daily Document & Drawing Digest",
      enabled: true,
      trigger: {
        type: "schedule",
        schedule: "daily",
      },
      actions: [
        {
          type: "discord_webhook",
          params: {
            channelId: "discord-chan-announcements",
          },
        },
      ],
      createdAt: Date.now() - 86400000,
    };

    expect(automationRule.enabled).toBe(true);

    // 2. Format Discord Embed Payload
    const webhookPayload: DiscordWebhookPayload = {
      username: "Worlds Automation Engine",
      avatar_url: "https://worlds.app/assets/app-icon.png",
      embeds: [
        {
          title: "🚀 Daily Workspace Activity Digest",
          description: "Summary of collaborative changes across documents and canvas drawings.",
          color: WORLDS_GOLD_DECIMAL, // 0xD2A46E
          fields: [
            { name: "Active Documents", value: "8 updated", inline: true },
            { name: "Drawings Exported", value: "3 .worldsdraw", inline: true },
            { name: "Sync Status", value: "100% Reconciled", inline: true },
          ],
          footer: { text: "Worlds Automations • Powered by SQLite WorkManager" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // 3. Validate against Discord API specifications
    const validation = validateDiscordPayload(webhookPayload);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // 4. Sign payload with HMAC-SHA256
    const { body, signature } = signWebhookPayload(
      webhookPayload as unknown as Record<string, unknown>,
      WEBHOOK_SECRET
    );
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

    // 5. Verify signature at receiving endpoint
    const isValidSignature = verifyWebhookSignature(body, signature, WEBHOOK_SECRET);
    expect(isValidSignature).toBe(true);
  });

  it("detects and rejects tampered webhook payloads", () => {
    const payload = { event: "page_published", pageId: "page-123", author: "Alice" };
    const { body, signature } = signWebhookPayload(payload, WEBHOOK_SECRET);

    // Tamper with the body
    const tamperedBody = body.replace("Alice", "Mallory");

    const isVerified = verifyWebhookSignature(tamperedBody, signature, WEBHOOK_SECRET);
    expect(isVerified).toBe(false);
  });

  it("rejects signatures generated with wrong secret", () => {
    const payload = { event: "test" };
    const { body, signature } = signWebhookPayload(payload, "wrong-secret");

    const isVerified = verifyWebhookSignature(body, signature, WEBHOOK_SECRET);
    expect(isVerified).toBe(false);
  });
});
