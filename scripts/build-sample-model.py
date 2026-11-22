"""Builds public/sample-model.glb from the Objaverse copy of the Sketchfab model "Microscope" by Eugen Vahrushin (CC BY 4.0).

The source is one mesh with one material. This script splits it into the named parts below (by connected piece, then by
the PART_PIECES table), bakes the node transforms and a uniform scale into the vertices, rests the model on y = 0,
shrinks the textures to JPEG, stores normals and UVs as normalized integers (KHR_mesh_quantization) and writes one glTF
node per part.

Run: uv run --no-project --with numpy --with scipy --with pillow python scripts/build-sample-model.py <source.glb> <output.glb>
Add --list to print every connected piece with its number and bounds instead of writing a file.
The source is data only: this script reads it and never runs anything from it.
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

TARGET_HEIGHT = 3.7 / 8  # model units before the studio's x8 scale

# Piece numbers come from number_pieces: most triangles first, ties broken by the lowest corner.
PART_PIECES = {
    'base': [18, 20, 21, 22, 23, 26, 28, 29, 34, 37, 39, 41],
    'arm': [0],
    'condenser': [8],
    'rack_post': [25, 33, 40, 45, 46, 47, 48, 50, 51],
    'focus_knob_left': [9, 12],
    'focus_knob_right': [10, 13],
    'stage': [1, 2, 16, 17, 24, 30, 31, 32, 35, 36, 44, 49, 52, 59],
    'stage_clips': [4, 19, 53, 54, 55, 56, 57, 58],
    'nosepiece': [6, 15, 27, 38, 42, 43],
    'objective_left': [11],
    'objective_centre': [14],
    'objective_right': [5],
    'head_cap': [3],
    'eyepiece_tube': [7],
}


def read_glb(path):
    data = open(path, 'rb').read()
    json_length = struct.unpack('<I', data[12:16])[0]
    document = json.loads(data[20:20 + json_length])
    binary = data[20 + json_length + 8:]
    return document, binary


def read_accessor(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    dtype = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[accessor['componentType']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return np.frombuffer(binary, dtype, accessor['count'] * width, offset).reshape(-1, width)


def node_matrix(node):
    return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T if 'matrix' in node else np.eye(4)


def label_pieces(positions, indices):
    welded = np.round(positions * 1e4).astype(np.int64)
    _, vertex_group = np.unique(welded, axis=0, return_inverse=True)
    vertex_group = vertex_group.ravel()
    corners = vertex_group[indices]
    rows = np.concatenate([corners[:, 0], corners[:, 1]])
    columns = np.concatenate([corners[:, 1], corners[:, 2]])
    count = vertex_group.max() + 1
    graph = coo_matrix((np.ones(len(rows)), (rows, columns)), shape=(count, count))
    _, labels = connected_components(graph, directed=False)
    return labels[corners[:, 0]]


def number_pieces(positions, indices, triangle_piece):
    pieces = []
    for piece in np.unique(triangle_piece):
        selected = triangle_piece == piece
        points = positions[indices[selected].ravel()]
        pieces.append((int(selected.sum()), tuple(np.round(points.min(axis=0), 3)), tuple(np.round(points.max(axis=0), 3)), piece))
    pieces.sort(key=lambda entry: (-entry[0], entry[1]))
    return {entry[3]: number for number, entry in enumerate(pieces)}, pieces


def encode_image(png_bytes, size, quality):
    image = Image.open(io.BytesIO(png_bytes)).convert('RGB').resize((size, size), Image.LANCZOS)
    output = io.BytesIO()
    image.save(output, 'JPEG', quality=quality, optimize=True)
    return output.getvalue()


def pad4(data, fill=b'\x00'):
    return data + fill * (-len(data) % 4)


def load_model(source_path):
    document, binary = read_glb(source_path)
    primitive = document['meshes'][0]['primitives'][0]
    positions = read_accessor(document, binary, primitive['attributes']['POSITION']).astype(np.float64)
    normals = read_accessor(document, binary, primitive['attributes']['NORMAL']).astype(np.float64)
    uvs = read_accessor(document, binary, primitive['attributes']['TEXCOORD_0']).astype(np.float64)
    indices = read_accessor(document, binary, primitive['indices']).reshape(-1, 3).astype(np.int64)
    transform = node_matrix(document['nodes'][0]) @ node_matrix(document['nodes'][1]) @ node_matrix(document['nodes'][3])
    rotation = transform[:3, :3]
    world = positions @ rotation.T + transform[:3, 3]
    world_normals = normals @ rotation.T
    world_normals /= np.linalg.norm(world_normals, axis=1, keepdims=True)
    return document, binary, world, world_normals, uvs, indices


def main(source_path, output_path, list_only):
    document, binary, world, world_normals, uvs, indices = load_model(source_path)
    triangle_piece = label_pieces(world, indices)
    numbering, pieces = number_pieces(world, indices, triangle_piece)
    if list_only:
        for number, (count, low, high, _) in enumerate(pieces):
            print(number, count, low, high)
        return
    triangle_number = np.array([numbering[piece] for piece in triangle_piece])
    part_of_piece = {number: key for key, numbers in PART_PIECES.items() for number in numbers}
    assert sorted(part_of_piece) == list(range(len(numbering))), 'every piece must belong to exactly one part'

    scale = TARGET_HEIGHT / (world[:, 1].max() - world[:, 1].min())
    base_vertices = np.unique(indices[np.isin(triangle_number, PART_PIECES['base'][:1])].ravel())
    centre_x = (world[base_vertices, 0].max() + world[base_vertices, 0].min()) / 2
    centre_z = (world[base_vertices, 2].max() + world[base_vertices, 2].min()) / 2
    shifted = (world - np.array([centre_x, world[:, 1].min(), centre_z])) * scale

    blob = bytearray()
    views = []
    accessors = []
    meshes = []
    nodes = []

    def add_view(data, target=None, byte_stride=None):
        offset = len(blob)
        blob.extend(pad4(data))
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            view['target'] = target
        if byte_stride:
            view['byteStride'] = byte_stride
        views.append(view)
        return len(views) - 1

    for key, numbers in PART_PIECES.items():
        selected = np.isin(triangle_number, numbers)
        part_indices = indices[selected]
        used = np.unique(part_indices.ravel())
        remap = np.full(len(world), -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        part_positions = shifted[used].astype(np.float32)
        padded_normals = np.zeros((len(used), 4), dtype=np.int8)
        padded_normals[:, :3] = np.clip(np.round(world_normals[used] * 127), -127, 127)
        part_uvs = np.round(np.clip(uvs[used], 0, 1) * 65535).astype(np.uint16)
        local = remap[part_indices].astype(np.uint16).ravel()

        position_view = add_view(part_positions.tobytes(), 34962)
        normal_view = add_view(padded_normals.tobytes(), 34962, byte_stride=4)
        uv_view = add_view(part_uvs.tobytes(), 34962)
        index_view = add_view(local.tobytes(), 34963)
        first = len(accessors)
        accessors.extend([
            {'bufferView': position_view, 'componentType': 5126, 'count': len(used), 'type': 'VEC3', 'min': part_positions.min(axis=0).tolist(), 'max': part_positions.max(axis=0).tolist()},
            {'bufferView': normal_view, 'componentType': 5120, 'normalized': True, 'count': len(used), 'type': 'VEC3'},
            {'bufferView': uv_view, 'componentType': 5123, 'normalized': True, 'count': len(used), 'type': 'VEC2'},
            {'bufferView': index_view, 'componentType': 5123, 'count': int(local.size), 'type': 'SCALAR'},
        ])
        meshes.append({'name': key, 'primitives': [{'attributes': {'POSITION': first, 'NORMAL': first + 1, 'TEXCOORD_0': first + 2}, 'indices': first + 3, 'material': 0}]})
        nodes.append({'name': key, 'mesh': len(meshes) - 1})
        print(key, len(used), 'vertices', int(selected.sum()), 'triangles')

    source_images = []
    for image in document['images']:
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        source_images.append(binary[start:start + view['byteLength']])
    # Texture order in the source: 0 base colour, 1 occlusion/roughness/metal, 2 normal, 3 clearcoat.
    jpeg_settings = [(1024, 85), (512, 80), (512, 90), (512, 80)]
    images = [{'bufferView': add_view(encode_image(source_images[number], size, quality)), 'mimeType': 'image/jpeg'} for number, (size, quality) in enumerate(jpeg_settings)]

    material = json.loads(json.dumps(document['materials'][0]))
    material['name'] = 'Microscope'
    output_document = {
        'asset': {'version': '2.0', 'generator': 'scripts/build-sample-model.py', 'copyright': 'Microscope by Eugen Vahrushin, CC BY 4.0, https://sketchfab.com/3d-models/microscope-9562226299a045bab13c3d66f8593208'},
        'extensionsUsed': ['KHR_materials_clearcoat', 'KHR_mesh_quantization'],
        'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes, 'meshes': meshes, 'materials': [material],
        'textures': [{'sampler': 0, 'source': number} for number in range(4)], 'images': images,
        'samplers': document['samplers'], 'accessors': accessors, 'bufferViews': views,
        'buffers': [{'byteLength': len(blob)}],
    }
    json_bytes = pad4(json.dumps(output_document, separators=(',', ':')).encode(), b' ')
    binary_bytes = bytes(blob)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    with open(output_path, 'wb') as output:
        output.write(struct.pack('<4sII', b'glTF', 2, total))
        output.write(struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes)
        output.write(struct.pack('<I4s', len(binary_bytes), b'BIN\x00') + binary_bytes)
    print('wrote', output_path, total, 'bytes; height', float(shifted[:, 1].max()))


if __name__ == '__main__':
    arguments = [argument for argument in sys.argv[1:] if argument != '--list']
    main(arguments[0], arguments[1] if len(arguments) > 1 else None, '--list' in sys.argv)
