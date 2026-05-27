# Jotform 9-photo proof camera widget

This is a standalone Jotform Custom Widget. It captures 9 required proof photos with camera-only input, adds time and GPS watermarks, uploads each photo to the form owner's Dropbox, and saves only links, metadata, and hashes back to Jotform.

## Files

- `index.html`: widget page
- `styles.css`: widget styles
- `widget.js`: camera, GPS, upload, and Jotform API logic
- `api/upload.js`: Vercel serverless upload API
- `api/dropbox/connect.js`: starts Dropbox OAuth
- `api/dropbox/callback.js`: saves Dropbox OAuth refresh tokens
- `api/dropbox/status.js`: checks whether a form is connected to Dropbox
- `package.json`: upload API dependency

## Photo checklist

The widget requires these 9 photos:

1. Exterior front-left 45 degrees
2. Exterior front-right 45 degrees
3. Exterior rear-left 45 degrees
4. Exterior rear-right 45 degrees
5. VIN / vehicle plate
6. Interior front seats
7. Interior rear seats
8. Dashboard
9. Odometer reading

Each photo is watermarked with:

- Photo item and index
- Local capture time
- GPS latitude and longitude
- GPS accuracy

## User flow

1. The customer taps `Start camera`.
2. The customer captures each required angle in order.
3. `Retake` only clears and retakes the currently selected angle.
4. The widget checks the Jotform name and email fields.
5. After all 9 photos are captured, the main button changes to `Upload all photos`.
6. The customer taps `Upload all photos`; the widget uploads the photos to the connected Dropbox and sends only links, metadata, and hashes to Jotform.
7. The Jotform form can be submitted after upload is complete.

## Jotform value

Jotform receives a JSON string like this. It does not contain base64 image data.

```json
{
  "proofMode": "camera-only-9-photos-linked",
  "captureToken": "jf-example",
  "total": 9,
  "completedAt": "2026-05-27T00:00:00.000Z",
  "photos": [
    {
      "index": 1,
      "key": "front_left_45",
      "label": "Exterior front-left 45 degrees",
      "url": "https://cdn.example.com/jotform-proof/jf-example/01-front_left_45.jpg",
      "storageKey": "jotform-proof/jf-example/01-front_left_45.jpg",
      "metadataKey": "jotform-proof/jf-example/01-front_left_45.json",
      "sha256": "abc123...",
      "bytes": 123456,
      "contentType": "image/jpeg",
      "uploadedAt": "2026-05-27T00:00:00.000Z",
      "metadata": {}
    }
  ]
}
```

## Dropbox OAuth setup

Customers who fill out the Jotform form do not need Dropbox accounts and do not sign in to Dropbox. The form owner connects Dropbox once through the widget.

Create a Dropbox app in the Dropbox developer console, then add this redirect URI to the Dropbox app settings:

```text
https://jotform-proof-camera-standalone.vercel.app/api/dropbox/callback
```

Set these in Vercel Project Settings -> Environment Variables:

```text
STORAGE_PROVIDER=dropbox
DROPBOX_APP_KEY=your-dropbox-app-key
DROPBOX_APP_SECRET=your-dropbox-app-secret
DROPBOX_REDIRECT_URI=https://jotform-proof-camera-standalone.vercel.app/api/dropbox/callback
DROPBOX_BASE_FOLDER=/JotformProof
OAUTH_SECRET=a-long-random-secret-used-to-encrypt-refresh-tokens
KV_REST_API_URL=your-vercel-kv-or-upstash-redis-rest-url
KV_REST_API_TOKEN=your-vercel-kv-or-upstash-redis-rest-token
```

The form owner's Dropbox refresh token is encrypted with `OAUTH_SECRET` before it is saved in KV/Redis.

The widget uploads each JPEG and a matching metadata JSON file. Example Dropbox paths:

```text
/JotformProof/jotform-proof/form-123456789/jf-example/01-front_left_45.jpg
/JotformProof/jotform-proof/form-123456789/jf-example/01-front_left_45.json
```

The API also creates a Dropbox shared link for each photo and returns that link to Jotform.

## Jotform setup

Use this URL as the Custom Widget URL:

```text
https://jotform-proof-camera-standalone.vercel.app/index.html
```

You can optionally add a folder name per form or workflow:

```text
https://jotform-proof-camera-standalone.vercel.app/index.html?folder=vehicle-inspection
```

In Jotform:

1. Open the form builder.
2. Add a Custom Widget.
3. Paste the widget URL above.
4. Save the form.
5. Open the form as the form owner and click `Connect Dropbox`.
6. Authorize Dropbox in the popup window.
7. Test on a phone so camera and GPS behave like the real workflow.

After Dropbox is connected for that form, customers can fill out the form without seeing Dropbox login.

## Optional folder grouping

You can pass extra query parameters to make Dropbox folders easier to identify:

```text
https://jotform-proof-camera-standalone.vercel.app/index.html?installKey=vehicle-inspection&folder=vehicle-inspection&customer=John-Smith&email=john@example.com
```

Dropbox folder example:

```text
/JotformProof/jotform-proof/vehicle-inspection/john@example.com/jf-example/
```

The Jotform submission value includes:

```json
{
  "dropboxFolderUrl": "https://dl.dropboxusercontent.com/...",
  "dropboxFolderPath": "/JotformProof/...",
  "submitter": {
    "name": "John-Smith",
    "email": "john@example.com"
  }
}
```

The form owner can also use `Disconnect` in the widget to remove the Dropbox connection for that `installKey`.

## Matching photos to Jotform submissions

The widget uploads photos before the final Jotform submit, so every upload batch has a stable `captureToken` and `dropboxFolderUrl`. These are included in the widget value that Jotform saves on submit.

Recommended setup:

1. Add this widget as a real Jotform widget field, not only a plain iframe, so `JFCustomWidget.sendSubmit` can save the value.
2. The widget requires the Jotform form to have name and email values before upload. Pass the Jotform field unique names or field IDs in the widget URL:

```text
https://jotform-proof-camera-standalone.vercel.app/index.html?installKey=vehicle-inspection&folder=vehicle-inspection&nameField=q3_name&emailField=q4_email
```

You can also use field IDs:

```text
https://jotform-proof-camera-standalone.vercel.app/index.html?installKey=vehicle-inspection&folder=vehicle-inspection&nameFieldId=3&emailFieldId=4
```

3. After `Upload all photos`, the customer must still submit the Jotform form. The submission value includes:

```json
{
  "captureToken": "jf-example",
  "dropboxFolderUrl": "https://dl.dropboxusercontent.com/...",
  "dropboxFolderPath": "/JotformProof/...",
  "submitter": {
    "name": "John Smith",
    "email": "john@example.com"
  }
}
```

If a customer uploads photos but never submits the Jotform form, the files will remain in Dropbox as an upload batch folder. Use the `captureToken`, timestamp, and optional `customer/email` folder name to identify or clean up those orphaned uploads.

## Security note

This improves evidence quality but is not absolute proof. Users may still spoof location, device time, or camera input. For higher proof strength, store server receipt time, verify hashes, restrict bucket writes to the serverless API only, and optionally add a one-time challenge code.
