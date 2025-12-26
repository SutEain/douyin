import struct
import os

def get_video_resolution(filepath):
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'rb') as f:
        data = f.read(10000) # Read enough to find 'avcC' or 'tkhd'
        # Simple search for 'tkhd' (track header)
        idx = data.find(b'tkhd')
        if idx != -1:
            # tkhd box: 4 bytes size, 4 bytes 'tkhd', 1 byte version, 3 bytes flags, ...
            # Version 0: 4 bytes creation, 4 bytes modification, 4 bytes track_id, 4 bytes reserved, 4 bytes duration
            # Version 1: 8 bytes creation, 8 bytes modification, 4 bytes track_id, 4 bytes reserved, 8 bytes duration
            version = data[idx+4]
            if version == 0:
                # Width is at offset 76, height at 80 (relative to idx)
                width = struct.unpack('>I', data[idx+84:idx+88])[0] >> 16
                height = struct.unpack('>I', data[idx+88:idx+92])[0] >> 16
                return width, height
            elif version == 1:
                width = struct.unpack('>I', data[idx+96:idx+100])[0] >> 16
                height = struct.unpack('>I', data[idx+100:idx+104])[0] >> 16
                return width, height
    return None

files = [
    "public/assets/gifts/effects/麦吉兔.mp4",
    "public/assets/gifts/effects/午夜派对.mp4",
    "public/assets/gifts/effects/飞屋环游.mp4",
    "public/assets/gifts/effects/小纸船.mp4",
    "public/assets/gifts/effects/百合花束.mp4"
]

for f in files:
    res = get_video_resolution(f)
    print(f"{f}: {res}")

