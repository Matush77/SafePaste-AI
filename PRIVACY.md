# SafePaste AI Privacy Policy

SafePaste AI runs locally in the browser and does not transmit pasted content to any server.

## Data Processed

The extension reads text only when the user pastes or drops it into the prompt editor of a supported AI chat website. For rich-text pastes it also reads the HTML version of the clipboard, to check links for hidden sensitive values. Supported websites:

- `https://chatgpt.com/`
- `https://gemini.google.com/`
- `https://claude.ai/`

The text is scanned locally for sensitive data and redacted before it is inserted into the page.

## Optional Name Detection Model

If the user turns on "Enhanced name detection" in the extension's settings, the extension downloads a name-detection model (about 66 MB) from Hugging Face (`huggingface.co`) once and keeps it in the browser's cache. This download request is the only network request the extension makes. It contains no pasted text or other user data; like any download, it reveals the user's IP address to Hugging Face. The model then runs on the user's device, and pasted text is never sent to Hugging Face or anyone else. The feature is off by default.

## Data Stored

The extension stores:

- User settings, such as enabled detection categories.
- A local summary of the most recent redaction, including timestamp, supported site name, and redaction counts.
- If the optional name detection model is turned on: the model files, in the browser's cache, and a flag noting that they were downloaded.

The extension does not store original sensitive values or redacted prompt text.

## Data Shared

No data is sold, transferred, or shared with third parties by the extension.

## Remote Code

The extension does not load or execute remote code. All code, including the WebAssembly runtime that runs the optional name model, ships inside the extension package. The optional model download contains model weights (data), not code.

## Contact

Use the Chrome Web Store support contact configured for this extension listing.

SafePaste AI is independent and is not affiliated with the third-party AI chat services it supports.
