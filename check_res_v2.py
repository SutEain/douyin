import struct
import os

def get_video_resolution(filepath):
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'rb') as f:
        data = f.read(20000)
        # Search for 'mvhd' first which is usually before 'tkhd'
        idx = data.find(b'tkhd')
        if idx != -1:
            # The dimensions are at the end of tkhd box
            # Box size (4) + Type (4) + Version (1) + Flags (3) + Creation (4/8) + Mod (4/8) + TrackID (4) + Res (4) + Duration (4/8) + Res (8) + Layer (2) + AltGroup (2) + Volume (2) + Res (2) + Matrix (36) + Width (4) + Height (4)
            version = data[idx+4]
            if version == 0:
                # 4+4+1+3+4+4+4+4+4+8+2+2+2+2+36 = 80
                # Width at 80, Height at 84
                w_pos = idx + 8 + 76
                h_pos = idx + 8 + 80
                width = struct.unpack('>I', data[w_pos:w_pos+4])[0] >> 16
                height = struct.unpack('>I', data[h_pos:h_pos+4])[0] >> 16
                return width, height
            else:
                # 4+4+1+3+8+8+4+4+8+8+2+2+2+2+36 = 92
                w_pos = idx + 8 + 88
                h_pos = idx + 8 + 92
                width = struct.unpack('>I', data[w_pos:w_pos+4])[0] >> 16
                height = struct.unpack('>I', data[h_pos:h_pos+4])[0] >> 16
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

