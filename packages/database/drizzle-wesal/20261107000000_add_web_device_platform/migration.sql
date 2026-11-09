-- Browser Web Push subscriptions are stored as device tokens with
-- platform 'web' (the token is the JSON PushSubscription), next to the
-- existing iOS/Android Expo tokens. Adding an enum value is additive: old
-- code never writes or reads 'web', so this is safe to apply before deploy.
ALTER TYPE "devicePlatform" ADD VALUE IF NOT EXISTS 'web';
