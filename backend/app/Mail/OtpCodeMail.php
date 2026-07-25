<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Delivers a signup verification code.
 *
 * In local dev MAIL_MAILER=log, so the rendered mail (and therefore the code)
 * lands in storage/logs/laravel.log instead of being sent.
 */
class OtpCodeMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $code,
        public int $ttlMinutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Your Saji verification code');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.otp');
    }
}
