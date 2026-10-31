# DECKED

Local-first DJ console for iPhone Safari and desktop browsers.

**Use:** Open https://shlangangang.github.io/Deck/ in Safari. Tap **＋** on Deck A or B, pick an unprotected MP3/M4A/WAV from Files, then press **▶**. Use the **LIBRARY** drawer to save tracks to the device or load them again later.

## How it works

- Native HTML audio players load local audio immediately from a Blob URL. No Web Audio decoding is required just to select and play a song.
- When supported, Web Audio provides equal-power crossfading, filters and echo. If Web Audio is unavailable, native audio playback remains available.
- Vinyl touch controls scrub position and produce playback stutter; reverse sample-accurate vinyl scratching is not supported by the native playback engine.
- Four stem files can be imported and controlled as separate players; timing may drift slightly on mobile hardware.
- The browser's IndexedDB stores music metadata and audio Blobs separately. Importing into a deck does not depend on database storage succeeding.
- The optional ytpmp3 beta connector needs a provider key, website CORS support and rights to the source audio. It has not been verified end-to-end.

## Notes

Protected Apple Music streaming downloads cannot be opened as editable audio files. Imported music is not uploaded by DECKED. Safari clearing website data can delete its saved library, so keep original music in Files.
