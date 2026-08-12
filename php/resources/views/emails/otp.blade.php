<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Your Saji verification code</title>
</head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;">Verify your email</h1>

        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4a4a4a;">
            Use this code to finish creating your Saji account:
        </p>

        <p style="margin:0 0 24px;font-size:36px;font-weight:700;letter-spacing:10px;text-align:center;padding:20px;background:#f5f5f5;border-radius:8px;">
            {{ $code }}
        </p>

        <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#4a4a4a;">
            This code expires in {{ $ttlMinutes }} minutes.
        </p>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#8a8a8a;">
            If you didn't request it, you can safely ignore this email.
        </p>
    </div>
</body>
</html>
