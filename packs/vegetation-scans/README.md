# Vegetation scans

Scanned bark and leaf cards for recipe trees. Install it and every recipe tree draws its bark and leaves from these scans
instead of the procedural textures:

```sh
unzip vegetation-scans-1.0.0.zip -d packs/vegetation-scans
crucible-mcp --packs /absolute/path/to/packs
```

| Species | Bark | Leaves |
| --- | --- | --- |
| broadleaf | [Bark Brown 02](https://polyhaven.com/a/bark_brown_02), Rob Tuytel | [LeafSet024](https://ambientcg.com/view?id=LeafSet024) |
| birch | procedural (no birch scan yet) | [LeafSet024](https://ambientcg.com/view?id=LeafSet024) |
| conifer | [Pine Bark](https://polyhaven.com/a/pine_bark), Dimitrios Savva | [LeafSet019](https://ambientcg.com/view?id=LeafSet019) |
| palm | [Palm Tree Bark](https://polyhaven.com/a/palm_tree_bark), Dimitrios Savva, Rico Cilliers | procedural |
| bush | [Bark Willow 02](https://polyhaven.com/a/bark_willow_02), Charlotte Baglioni | [LeafSet022](https://ambientcg.com/view?id=LeafSet022) |

Every scan is CC0 1.0 from [Poly Haven](https://polyhaven.com) or [ambientCG](https://ambientcg.com) (leaf atlases by Lennart
Demes). Bark maps are base colour (sRGB), normal (OpenGL) and roughness (grey). Leaf cards are colour with alpha, normal and a
crown clump for far trees, composited by `scripts/build-leaf-cards.py`. `scripts/build-vegetation-scans-pack.py` rebuilds the
folder.
