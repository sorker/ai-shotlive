# App Icons

electron-builder needs platform-specific icon formats:

- `icon.icns` — macOS (can be generated from a 1024x1024 PNG)
- `icon.ico` — Windows (can be generated from a 256x256+ PNG)
- `icon.png` — Source PNG (used as fallback by electron-builder)

## Generate icons from PNG

On macOS, you can generate `.icns` using:

```bash
# Create iconset from 1024x1024 PNG
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
rm -rf icon.iconset
```

For `.ico`, use an online converter or ImageMagick:

```bash
convert icon.png -resize 256x256 icon.ico
```

**Note:** electron-builder can auto-convert from `.png` on most systems, so having `icon.png` alone may suffice.
