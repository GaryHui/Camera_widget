# Jotform 9-photo proof camera widget

This is a standalone Jotform Custom Widget. It captures 9 required proof photos with camera-only input, adds time and GPS watermarks, uploads each photo to Dropbox or S3-compatible storage, and saves only links, metadata, and hashes back to Jotform.

## Files

- `index.html`: widget page
- `styles.css`: widget styles
- `widget.js`: camera, GPS, upload, and Jotform API logic
- `api/upload.js`: Vercel serverless upload API
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
4. After all 9 photos are captured, the main button changes to `Upload all photos`.
5. The customer taps `Upload all photos`; the widget uploads the photos to Dropbox and sends only links, metadata, and hashes to Jotform.
6. The Jotform form can be submitted after upload is complete.

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

## Dropbox setup

This setup is for the form owner. Customers who fill out the Jotform form do not need Dropbox accounts and do not sign in to Dropbox.

Set these in Vercel Project Settings -> Environment Variables to upload photos to Dropbox:

```text
STORAGE_PROVIDER=dropbox
DROPBOX_ACCESS_TOKEN=your-long-lived-or-temporary-access-token
DROPBOX_BASE_FOLDER=/JotformProof
```

For production, a refresh token is better than a temporary access token:

```text
STORAGE_PROVIDER=dropbox
DROPBOX_REFRESH_TOKEN=your-refresh-token
DROPBOX_APP_KEY=your-dropbox-app-key
DROPBOX_APP_SECRET=your-dropbox-app-secret
DROPBOX_BASE_FOLDER=/JotformProof
```

The widget uploads each JPEG and a matching metadata JSON file. Example Dropbox paths:

```text
/JotformProof/jotform-proof/form-123456789/jf-example/01-front_left_45.jpg
/JotformProof/jotform-proof/form-123456789/jf-example/01-front_left_45.json
```

The API also creates a Dropbox shared link for each photo and returns that link to Jotform.

## S3 / R2 setup

Set these in Vercel Project Settings -> Environment Variables:

```text
STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket-name
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_PUBLIC_BASE_URL=https://your-public-domain.example.com
```

For AWS S3, `S3_ENDPOINT` can be omitted and `S3_REGION` should be the AWS region, for example `us-east-1`.

For Cloudflare R2, use an R2 API token with object read/write permission, set `S3_REGION=auto`, and set `S3_PUBLIC_BASE_URL` to a public R2 custom domain or public bucket URL. Without `S3_PUBLIC_BASE_URL`, the upload will still return storage keys and hashes, but not public image URLs.

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
5. Test on a phone so camera and GPS behave like the real workflow.

## Security note

This improves evidence quality but is not absolute proof. Users may still spoof location, device time, or camera input. For higher proof strength, store server receipt time, verify hashes, restrict bucket writes to the serverless API only, and optionally add a one-time challenge code.
