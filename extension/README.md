# Worlds browser extension

Saves the page you are on, the text you selected, a link, or an article to
read later into Worlds on the same computer.

1. In Chrome or Edge open `chrome://extensions` (or `edge://extensions`),
   turn on Developer mode, choose **Load unpacked** and pick this folder.
2. In Worlds open **Settings › Editor › Browser extension** and copy the token.
3. Open the extension, expand **Connect to Worlds** and paste the token.

The extension talks only to `http://127.0.0.1:47321`, the capture server the
Worlds app runs on this computer, and every request carries the token.
