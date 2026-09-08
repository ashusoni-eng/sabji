import imageCompression from 'browser-image-compression'

/**
 * A photo straight off a phone camera is 3–8 MB. Uploading that over Indian
 * mobile data is slow enough that admins give up on adding products, so every
 * image is compressed in the browser BEFORE it leaves the device.
 */
export async function compressProductImage(file) {
  if (!file) return null
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
    throw new Error('Please choose a JPG, PNG or WebP image.')
  }
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.4,
    maxWidthOrHeight: 1200,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.82,
  })
  // browser-image-compression returns a Blob; give it a real filename+type.
  return new File([compressed], `${crypto.randomUUID()}.webp`, { type: 'image/webp' })
}

export function readableSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
