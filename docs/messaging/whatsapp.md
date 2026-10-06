# WhatsApp Messaging

Craft Agents can connect to WhatsApp through the Messaging settings page. This page documents the expected setup flow and common troubleshooting steps for the WhatsApp integration.

## Connect WhatsApp

1. Open **Settings** in the Craft Agents desktop app.
2. Go to **Messaging**.
3. Find **WhatsApp** and click **Connect**.
4. Scan the QR code with WhatsApp on your phone.
5. Wait until the connection status changes to **Connected**.

Once connected, Craft Agents can use the WhatsApp messaging source in the workspace where it was configured.

## Reconnect WhatsApp

If the connection expires or messages stop syncing:

1. Open **Settings → Messaging**.
2. Open the WhatsApp actions menu.
3. Choose **Reconnect**.
4. Scan the new QR code if prompted.

## Disable or forget WhatsApp

Use **Disable** to stop the current WhatsApp runtime connection while keeping saved configuration.

Use **Forget** to remove the saved WhatsApp connection information completely.

## Troubleshooting

### The WhatsApp page does not open

Make sure you are using the latest Craft Agents build and restart the app after updating.

### QR code does not appear

Try reconnecting from **Settings → Messaging → WhatsApp**. If it still does not appear, restart Craft Agents and try again.

### Connection keeps dropping

Check that WhatsApp is still active on your phone and that your desktop has a stable network connection.

### Messages do not appear in a session

Confirm that the WhatsApp platform shows as **Connected** in **Settings → Messaging**, then re-bind the messaging source to the intended session.
