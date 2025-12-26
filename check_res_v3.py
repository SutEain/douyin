import struct
import os

def get_res(f):
    with open(f, 'rb') as f:
        data = f.read(40000)
        # Find 'tkhd'
        idx = data.find(b'tkhd')
        if idx != -1:
            # Skip size(4), type(4), version(1), flags(3)
            # Skip creation(4), mod(4), trackid(4), res(4), duration(4) -> 20 bytes
            # Total skip 4+4+1+3+20 = 32
            # Wait, version 1 is different.
            version = data[idx+4]
            if version == 0:
                # 4+4+1+3 + 4+4+4+4+4 + 8+2+2+2+2+36 = 80 bytes
                # Dimensions are at 80 and 84
                w = struct.unpack('>I', data[idx+88:idx+92])[0] >> 16
                h = struct.unpack('>I', data[idx+92:idx+96])[0] >> 16
                return w, h
            else:
                # 4+4+1+3 + 8+8+4+4+8 + 8+2+2+2+2+36 = 92
                w = struct.unpack('>I', data[idx+100:idx+104])[0] >> 16
                h = struct.unpack('>I', data[idx+104:idx+108])[0] >> 16
                return w, h
    return None

files = [
    "public/assets/gifts/effects/麦吉兔.mp4",
    "public/assets/gifts/effects/午夜派对.mp4",
    "public/assets/gifts/effects/小纸船.mp4"
]
for f in files:
    print(f"{f}: {get_res(f)}")

