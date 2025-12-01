EazyPasswords — Zero-Knowledge Password Manager (Beta)

This project is a zero-knowledge password manager built to learn cryptography, client-side security, and backend design. All encryption happens on the user’s device before anything is sent to the server.

Project Structure
	•	app.js
This is where all zero-knowledge logic happens.
It handles key derivation, client-side encryption/decryption, and secure communication with the backend.
	•	eazypasswords.html
The main HTML page for the password manager interface.
	•	index.html
The front page/landing page of the website.

How It Works

All user data is encrypted client-side using a key derived from the user’s password. The server never receives or stores plaintext data. Only encrypted blobs are uploaded and synced. This design makes the application zero-knowledge by default.

Status

This project is currently in beta.
It is not yet recommended for storing highly sensitive real-world passwords.
