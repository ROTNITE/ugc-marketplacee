import { logger } from "../observability/logger.js";

export type PushNotification = {
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushProvider = {
  send(notification: PushNotification): Promise<void>;
};

export class LogPushProvider implements PushProvider {
  async send(notification: PushNotification): Promise<void> {
    logger.info(
      { device: notification.deviceToken.slice(0, 8) + "..." },
      "push send (dev)"
    );
  }
}

/**
 * Firebase Cloud Messaging legacy HTTP v1 endpoint via raw fetch.
 * Activates when FCM_SERVER_KEY is set.
 */
export class FcmPushProvider implements PushProvider {
  constructor(private readonly serverKey: string) {}

  async send(notification: PushNotification): Promise<void> {
    const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        Authorization: `key=${this.serverKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: notification.deviceToken,
        notification: { title: notification.title, body: notification.body },
        data: notification.data ?? {}
      })
    });
    if (!response.ok) {
      logger.error({ status: response.status }, "fcm send failed");
      throw new Error(`FCM responded ${response.status}`);
    }
  }
}
