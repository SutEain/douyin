import os

def find_dimensions(f):
    with open(f, 'rb') as f:
        data = f.read(40000)
        # Look for typical resolutions in hex
        # 1440 = 0x05A0
        # 1080 = 0x0438
        # 720 = 0x02D0
        # 540 = 0x021C
        # 1280 = 0x0500
        targets = [
            (1440, b'\x05\xA0'),
            (1080, b'\x04\x38'),
            (720, b'\x02\xD0'),
            (1280, b'\x05\x00'),
            (540, b'\x02\x1C')
        ]
        found = []
        for val, pattern in targets:
            if pattern in data:
                found.append(val)
        return found

files = [
    "public/assets/gifts/effects/麦吉兔.mp4",
    "public/assets/gifts/effects/午夜派对.mp4",
    "public/assets/gifts/effects/飞屋环游.mp4",
    "public/assets/gifts/effects/小纸船.mp4",
    "public/assets/gifts/effects/百合花束.mp4"
]

for f in files:
    print(f"{f}: {find_dimensions(f)}")

