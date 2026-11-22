"""Builds packs/vegetation-scans/ from CC0 bark scans and leaf cards.

Usage: uv run --no-project --with pillow python -I scripts/build-vegetation-scans-pack.py <public/textures folder> <bark_brown_02 folder>

The second folder holds the Poly Haven 1K maps of Bark Brown 02 (bark_brown_02_diff_1k.jpg, _nor_gl_1k.jpg, _rough_1k.jpg).
Every map is re-encoded to WebP with each side at most 1024 pixels, the pack image limit. Roughness drops to half size: it is
smooth, and the scene repacks it into the green channel of the metallic-roughness map.
"""
import json
import pathlib
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAXIMUM_SIDE = 1024
PACK_FOLDER = pathlib.Path(__file__).resolve().parent.parent / "packs" / "vegetation-scans"


def fit(image, maximum_side):
    scale = min(1.0, maximum_side / max(image.size))
    if scale == 1.0:
        return image
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)


def save(image, relative_path, maximum_side, mode, lossless=False):
    target = PACK_FOLDER / relative_path
    target.parent.mkdir(parents=True, exist_ok=True)
    fit(image.convert(mode), maximum_side).save(target, "WEBP", quality=90, method=6, lossless=lossless)
    return relative_path


def bark_sources(textures, brown_bark):
    return {
        "broadleaf": (brown_bark / "bark_brown_02_diff_1k.jpg", brown_bark / "bark_brown_02_nor_gl_1k.jpg", brown_bark / "bark_brown_02_rough_1k.jpg"),
        "conifer": tuple(textures / "pine_bark" / f"{channel}.webp" for channel in ("color", "normal", "roughness")),
        "palm": tuple(textures / "palm_tree_bark" / f"{channel}.webp" for channel in ("color", "normal", "roughness")),
        "bush": tuple(textures / "bark_willow_02" / f"{channel}.webp" for channel in ("color", "normal", "roughness")),
    }


def main():
    textures = pathlib.Path(sys.argv[1])
    brown_bark = pathlib.Path(sys.argv[2])
    images = []
    for species, (color, normal, roughness) in bark_sources(textures, brown_bark).items():
        images.append({"id": f"{species}-bark-color", "file": save(Image.open(color), f"bark/{species}/color.webp", MAXIMUM_SIDE, "RGB")})
        images.append({"id": f"{species}-bark-normal", "file": save(Image.open(normal), f"bark/{species}/normal.webp", MAXIMUM_SIDE, "RGB")})
        images.append({"id": f"{species}-bark-roughness", "file": save(Image.open(roughness), f"bark/{species}/roughness.webp", MAXIMUM_SIDE // 2, "L")})
    for species in ("broadleaf", "birch", "bush", "conifer"):
        folder = textures / "leaves" / species
        images.append({"id": f"{species}-leaf-color", "file": save(Image.open(folder / "color.webp"), f"leaves/{species}/color.webp", MAXIMUM_SIDE, "RGBA", lossless=True)})
        images.append({"id": f"{species}-leaf-normal", "file": save(Image.open(folder / "normal.webp"), f"leaves/{species}/normal.webp", MAXIMUM_SIDE, "RGB")})
        images.append({"id": f"{species}-leaf-crown", "file": save(Image.open(folder / "crown.webp"), f"leaves/{species}/crown.webp", MAXIMUM_SIDE, "RGBA", lossless=True)})
    manifest = {
        "format": "crucible.pack", "schemaVersion": 1,
        "name": "vegetation-scans", "version": "1.0.0", "engines": {"crucible": ">=0.22.0"},
        "license": "CC0-1.0", "author": "Poly Haven and ambientCG scans, packed by Crucible",
        "description": "Scanned bark and leaf cards that recipe trees draw with when this pack is installed.",
        "contents": {"images": images},
    }
    (PACK_FOLDER / "crucible-pack.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    print("ok", len(images), "images")


main()
