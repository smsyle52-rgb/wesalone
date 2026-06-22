# Legacy UI Inventory

The web app and mockup sandbox still contain Radix-backed shadcn and local shared components. They remain intentionally to avoid changing existing screens.

Known debt:

- duplicated UI trees between web and sandbox;
- existing Radix dependencies while consumers remain;
- custom modal code alongside generated dialogs;
- page-local styled controls and hard-coded values;
- React runtime 19.1 with React type packages 19.2;
- no repository lint or product integration-test baseline;
- sandbox build requires a `PORT` environment variable.

Do not delete old libraries or files until no consumers remain and migrated workflows pass acceptance.
