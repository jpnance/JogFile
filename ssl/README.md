# SSL Certificates for Local Development

This directory holds SSL certificates for local HTTPS development. The `.pem` files are gitignored. Production SSL stuff is handled by nginx and these containers don't need to know about it.

## TL;DR

1. ```bash
   runt generate-dev-certs
   ```

2. That's it. Hopefully.

## What the Runt Does

The runt uses [mkcert](https://github.com/FiloSottile/mkcert) to generate locally-trusted certificates. It creates `jogfile-key.pem` and `jogfile.pem` for `jogfile.coinflipper.local`.

If mkcert isn't installed, it'll tell you how to install it (Homebrew on macOS, pacman on Arch).

It makes mkcert's CA trusted system-wide so you don't get nagged in the browser about your own self-signed certificates.

The app uses these certs when running with `NODE_ENV=dev`. Production certs are handled entirely by certbot and nginx and the code itself doesn't have to care about them.
