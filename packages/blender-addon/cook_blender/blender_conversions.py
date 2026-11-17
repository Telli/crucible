"""Blender to Cook conversions that need no bpy: coordinates, camera, light units, depth and the Radiance HDR writer.

Only `math` is imported at module level, so the unit tests in tests/test_blender_conversions.py run in plain Python
(numpy is imported inside the functions that need arrays).
"""
import math

WATTS_PER_POINT_INTENSITY = 4.0 * math.pi
WATTS_PER_AREA_INTENSITY = math.pi
HDR_RADIANCE_LIMIT = 60000.0
# Blender is Z up, Cook is Y up: (x, y, z) becomes (x, z, -y). Row-major 4x4.
BLENDER_TO_YUP_ROWS = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, -1.0, 0.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)
AREA_SHAPES = {"SQUARE": "rectangle", "RECTANGLE": "rectangle", "DISK": "disk", "ELLIPSE": "ellipse"}
LUMINANCE_WEIGHTS = (0.2126, 0.7152, 0.0722)


# The tracer holds every texture in memory, so the total is bounded: 1 GiB is 16 distinct 4096 x 4096 RGBA images.
TEXTURE_BYTE_LIMIT = 1 << 30
WORLD_IMAGE_FILE_NAME = "world.hdr"
DEPTH_COVERAGE_NOTE = (
    "the Depth pass averages missed rays as 0, so a silhouette pixel that is partly background gets a smaller Z than Cycles writes; "
    "expect a dark halo along edges in depth of field or fog composites"
)


def texture_file_name(image_index):
    return f"texture-{image_index}.rgba"


def check_texture_budget(total_bytes, image_count):
    """Raises when the textures exported so far pass the limit; the message gives the totals and what to change."""
    if total_bytes > TEXTURE_BYTE_LIMIT:
        raise ValueError(
            f"The scene's {image_count} distinct textures add up to {total_bytes / (1 << 20):.0f} MB, above the {TEXTURE_BYTE_LIMIT / (1 << 20):.0f} MB "
            "Cook loads. Lower the texture size (Image > Resize) or use fewer distinct images."
        )


def to_yup(vector):
    return [float(vector[0]), float(vector[2]), float(-vector[1])]


def column_major_yup_matrix(blender_matrix_rows):
    """Takes four rows of four numbers (a Blender world matrix) and returns Cook's 16 numbers, column by column."""
    product = [
        [sum(BLENDER_TO_YUP_ROWS[row][inner] * blender_matrix_rows[inner][column] for inner in range(4)) for column in range(4)]
        for row in range(4)
    ]
    return [float(product[row][column]) for column in range(4) for row in range(4)]


def effective_horizontal_sensor_width(sensor_fit, sensor_width, sensor_height, width, height):
    """The sensor size across the image width, following Blender and Cycles.

    AUTO fits the longer image side to `sensor_width` (`sensor_height` is not read), so a portrait frame has a vertical sensor of
    `sensor_width`. HORIZONTAL fits the width to `sensor_width`; VERTICAL fits the height to `sensor_height`. The pixel aspect ratio
    is not applied (the exporter reports it)."""
    if sensor_fit == "HORIZONTAL":
        return sensor_width
    if sensor_fit == "VERTICAL":
        return sensor_height * width / height
    if width >= height:
        return sensor_width
    return sensor_width * width / height


def vertical_fov_degrees(horizontal_sensor_width, lens_millimetres, width, height):
    half_tangent_x = horizontal_sensor_width / (2.0 * lens_millimetres)
    half_tangent_y = half_tangent_x * height / width
    return math.degrees(2.0 * math.atan(half_tangent_y))


def sun_environment_fields(color, energy, emission_direction, angle):
    toward_light = [-component for component in emission_direction]
    return {
        "keyColor": [channel * energy for channel in color],
        "lightDirection": toward_light,
        "sunAngularRadius": angle / 2.0,
    }


def point_light_entry(position, color, energy, radius):
    return {"position": position, "color": color, "intensity": energy / WATTS_PER_POINT_INTENSITY, "radius": radius}


def spot_light_entry(position, color, energy, radius, emission_direction, spot_size, spot_blend):
    entry = point_light_entry(position, color, energy, radius)
    entry["direction"] = emission_direction
    entry["angle"] = spot_size / 2.0
    entry["penumbra"] = spot_blend
    return entry


def area_light_entry(position, color, energy, emission_direction, local_up, shape, size, size_y, scale_x, scale_y, spread):
    width_value = size * abs(scale_x)
    height_value = (size if shape in ("SQUARE", "DISK") else size_y) * abs(scale_y)
    return {
        "position": position,
        "color": color,
        "intensity": energy / WATTS_PER_AREA_INTENSITY,
        "width": width_value,
        "height": height_value,
        "direction": emission_direction,
        "up": [-component for component in local_up],
        "shape": AREA_SHAPES[shape],
        "spread": max(0.0001, min(math.pi, spread)),
    }


def z_depth_from_ray_distance(ray_distance, field_of_view_horizontal_tangent, field_of_view_vertical_tangent, missing_value=1.0e10):
    """Converts the tracer's distance along each ray into Blender's Z (distance along the view axis).

    `ray_distance` is a (height, width) array, 0 where the ray missed. The tangents are the half-field-of-view tangents of the
    pinhole camera. A miss becomes `missing_value`, which is what Cycles writes to Z for background pixels."""
    import numpy

    height, width = ray_distance.shape
    column_offsets = ((numpy.arange(width) + 0.5) / width * 2.0 - 1.0) * field_of_view_horizontal_tangent
    row_offsets = (1.0 - (numpy.arange(height) + 0.5) / height * 2.0) * field_of_view_vertical_tangent
    direction_length = numpy.sqrt(1.0 + row_offsets[:, None] ** 2 + column_offsets[None, :] ** 2)
    depth = ray_distance / direction_length
    return numpy.where(ray_distance > 0.0, depth, missing_value).astype(numpy.float32)


def rgbe_bytes(linear_rgb):
    """Packs a (height, width, 3) float array into Radiance RGBE bytes, one flat scanline after the other."""
    import numpy

    positive = numpy.maximum(linear_rgb.astype(numpy.float64), 0.0)
    brightest = positive.max(axis=2)
    mantissa, exponent = numpy.frexp(brightest)
    safe_brightest = numpy.where(brightest > 1e-32, brightest, 1.0)
    scale = numpy.where(brightest > 1e-32, mantissa * 256.0 / safe_brightest, 0.0)
    packed = numpy.zeros(positive.shape[:2] + (4,), dtype=numpy.uint8)
    packed[..., :3] = numpy.clip(positive * scale[..., None], 0, 255).astype(numpy.uint8)
    packed[..., 3] = numpy.where(brightest > 1e-32, exponent + 128, 0).astype(numpy.uint8)
    return packed.tobytes()


def write_radiance_hdr(path, linear_rgb_top_first):
    """Writes an uncompressed .hdr, which the Cook loader reads. The array has its first row at the top."""
    height, width, _ = linear_rgb_top_first.shape
    header = f"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {height} +X {width}\n".encode("ascii")
    with open(path, "wb") as handle:
        handle.write(header)
        handle.write(rgbe_bytes(linear_rgb_top_first))


def light_bounce_limit(light_max_bounces, scene_max_bounces):
    """The light's own Cycles `max_bounces` when it stops the light short of the scene's, else None (no per-light limit to carry).

    Either value is None when unreadable. A light's limit defaults to 1024, above any scene's, so most lights carry none."""
    if light_max_bounces is None or scene_max_bounces is None or light_max_bounces >= scene_max_bounces:
        return None
    return max(0, int(light_max_bounces))


def with_bounce_limit(entry, bounce_limit):
    """The light entry with `maxBounces` set when the light has its own limit, otherwise unchanged."""
    if bounce_limit is not None:
        entry["maxBounces"] = bounce_limit
    return entry


def light_feature_notes(light_name, light_type, use_temperature, use_shadow, diffuse_factor, specular_factor):
    """What a light carries that Cook does not read, one sentence each. Node trees are handled by `resolve_light_nodes`."""
    notes = []
    if use_temperature:
        notes.append(f"light {light_name} uses a blackbody temperature; Cook uses its plain colour")
    if not use_shadow:
        notes.append(f"light {light_name} has shadows off; Cook casts them")
    if abs(diffuse_factor - 1.0) > 1e-6 or abs(specular_factor - 1.0) > 1e-6:
        notes.append(f"light {light_name} has a diffuse or specular factor other than 1; Cook ignores the factors")
    return notes


def far_clip(clip_start, clip_end):
    """The camera's far plane: Blender's clip end, kept just past the near plane so the pair stays a valid range."""
    return max(clip_end, clip_start * 1.001 + 1e-6)


def no_visible_mesh_message(empty_mesh_count):
    """The error for a scene with nothing to draw; `empty_mesh_count` counts renderable mesh objects that evaluated to no triangles."""
    if empty_mesh_count > 0:
        return (
            f"The scene's {empty_mesh_count} mesh object(s) evaluate to no triangles. "
            "Check for empty meshes, or modifiers and Geometry Nodes that remove all faces."
        )
    return "The scene has no visible mesh to render. Check that objects are enabled for rendering (the camera icon in the Outliner)."


def lens_feature_notes(aperture_ratio):
    """What a camera's depth of field carries that Cook does not read, one sentence each."""
    notes = []
    if abs(aperture_ratio - 1.0) > 1e-6:
        notes.append(f"the camera has aperture ratio {aperture_ratio:g} (anamorphic bokeh); Cook uses a round aperture")
    return notes


# Blackbody colour. Blender's Blackbody node integrates Planck's law against the CIE 1931 colour matching functions and
# converts to linear Rec.709, scaled so 6500 K is white. Blender's own table is not available here, so the matching
# functions use the multi-lobe Gaussian fit of Wyman, Sloan and Shirley, "Simple Analytic Approximations to the CIE XYZ
# Color Matching Functions", JCGT 2(2), 2013, and the white scaling is done per channel at 6500 K. This is an
# approximation of Blender's table, not a copy of it.
BLACKBODY_WHITE_KELVIN = 6500.0
BLACKBODY_RANGE_KELVIN = (800.0, 12000.0)
XYZ_TO_LINEAR_REC709 = (
    (3.2404542, -1.5371385, -0.4985314),
    (-0.9692660, 1.8760108, 0.0415560),
    (0.0556434, -0.2040259, 1.0572252),
)
PLANCK_SECOND_RADIATION_CONSTANT = 1.4387769e-2
NEUTRAL_COLOUR_FACTOR = (1.0, 1.0, 1.0)


def _gaussian_lobe(wavelength, centre, left_width, right_width):
    width = left_width if wavelength < centre else right_width
    return math.exp(-0.5 * ((wavelength - centre) * width) ** 2)


def _cie_xyz_matching(wavelength):
    x_bar = (
        1.056 * _gaussian_lobe(wavelength, 599.8, 0.0264, 0.0323)
        + 0.362 * _gaussian_lobe(wavelength, 442.0, 0.0624, 0.0374)
        - 0.065 * _gaussian_lobe(wavelength, 501.1, 0.0490, 0.0382)
    )
    y_bar = 0.821 * _gaussian_lobe(wavelength, 568.8, 0.0213, 0.0247) + 0.286 * _gaussian_lobe(wavelength, 530.9, 0.0613, 0.0322)
    z_bar = 1.217 * _gaussian_lobe(wavelength, 437.0, 0.0845, 0.0278) + 0.681 * _gaussian_lobe(wavelength, 459.0, 0.0385, 0.0725)
    return x_bar, y_bar, z_bar


def _unscaled_blackbody_rgb(kelvin):
    xyz = [0.0, 0.0, 0.0]
    for wavelength in range(360, 831, 5):
        metres = wavelength * 1e-9
        radiance = metres ** -5 / math.expm1(PLANCK_SECOND_RADIATION_CONSTANT / (metres * kelvin))
        for axis, weight in enumerate(_cie_xyz_matching(float(wavelength))):
            xyz[axis] += radiance * weight
    return [sum(row[axis] * xyz[axis] for axis in range(3)) for row in XYZ_TO_LINEAR_REC709]


def blackbody_linear_rgb(kelvin):
    """Linear Rec.709 colour of a blackbody at `kelvin` (clamped to BLACKBODY_RANGE_KELVIN): white at 6500 K, negative channels 0, brightest channel 1."""
    low, high = BLACKBODY_RANGE_KELVIN
    kelvin = min(max(kelvin, low), high)
    white = _unscaled_blackbody_rgb(BLACKBODY_WHITE_KELVIN)
    balanced = [max(channel / white_channel, 0.0) for channel, white_channel in zip(_unscaled_blackbody_rgb(kelvin), white)]
    return [channel / max(balanced) for channel in balanced]


def _socket_summary(socket):
    linked_from = socket.links[0].from_node.name if socket.is_linked else None
    value = getattr(socket, "default_value", None)
    if hasattr(value, "__len__"):
        value = [float(channel) for channel in value]
    return {"value": value, "linked_from": linked_from}


def light_node_tree_summary(light_data):
    """The node tree of a light (a bpy Light or any object with the same attributes) as plain data for `resolve_light_nodes`.

    None when the light has no node tree. `light_data.use_nodes` is not read: it is deprecated in Blender 5 and always True,
    and a new light already carries a default Emission tree, so the tree itself is the test."""
    node_tree = getattr(light_data, "node_tree", None)
    if node_tree is None:
        return None
    output = next((node for node in node_tree.nodes if node.type == "OUTPUT_LIGHT" and node.is_active_output), None)
    surface = output.inputs["Surface"] if output is not None else None
    output_from = surface.links[0].from_node.name if surface is not None and surface.is_linked else None
    nodes = {node.name: {"type": node.type, "inputs": {socket.name: _socket_summary(socket) for socket in node.inputs}} for node in node_tree.nodes}
    return {"output_from": output_from, "nodes": nodes}


def resolve_light_nodes(light_name, node_tree):
    """Reads the Emission node of a light's node tree.

    `node_tree` is None for a light without nodes, else plain data: {"output_from": node id or None, "nodes": {id: {"type":
    "EMISSION", "inputs": {name: {"value": number or list, "linked_from": node id or None}}}}}. Returns (strength,
    colour_factor, notes): multiply the light's energy by `strength` and its colour by `colour_factor`. Anything that is not
    a constant Emission strength, a constant colour or a Blackbody with a constant temperature goes into `notes` as "not
    reproduced" and leaves the plain value in place."""
    if node_tree is None:
        return 1.0, list(NEUTRAL_COLOUR_FACTOR), []
    nodes = node_tree["nodes"]
    emission = nodes.get(node_tree.get("output_from"))
    if emission is None or emission["type"] != "EMISSION":
        found = "nothing" if emission is None else emission["type"]
        note = f"light {light_name} has a node tree whose output is {found}, not an Emission node; not reproduced, Cook uses the plain energy and colour"
        return 1.0, list(NEUTRAL_COLOUR_FACTOR), [note]
    notes = []
    strength = 1.0
    strength_input = emission["inputs"].get("Strength")
    if strength_input is not None:
        if strength_input.get("linked_from") is not None:
            source = nodes.get(strength_input["linked_from"], {}).get("type", "unknown")
            notes.append(f"light {light_name} strength comes from a {source} node; not reproduced, Cook uses the plain energy")
        else:
            strength = float(strength_input["value"])
    colour_factor = list(NEUTRAL_COLOUR_FACTOR)
    colour_input = emission["inputs"].get("Color")
    if colour_input is not None:
        colour_factor, colour_note = _emission_colour_factor(light_name, nodes, colour_input)
        if colour_note:
            notes.append(colour_note)
    return strength, colour_factor, notes


def _emission_colour_factor(light_name, nodes, colour_input):
    source_id = colour_input.get("linked_from")
    if source_id is None:
        return [float(channel) for channel in colour_input["value"][:3]], None
    source = nodes.get(source_id, {"type": "unknown", "inputs": {}})
    if source["type"] == "BLACKBODY":
        temperature = source["inputs"].get("Temperature", {})
        if temperature.get("linked_from") is None:
            kelvin = float(temperature["value"])
            low, high = BLACKBODY_RANGE_KELVIN
            if not low <= kelvin <= high:
                note = f"light {light_name} blackbody temperature {kelvin:g} K is outside {low:.0f} to {high:.0f} K; clamped, Cook uses the colour at the nearest end of that range"
                return blackbody_linear_rgb(kelvin), note
            return blackbody_linear_rgb(kelvin), None
    note = f"light {light_name} colour comes from a {source['type']} node that is not a Blackbody with a constant temperature; not reproduced, Cook uses the plain colour"
    return list(NEUTRAL_COLOUR_FACTOR), note


def blender_environment_to_cook_rows(linear_rgb_bottom_first):
    """Flips a Blender equirectangular image (first row at the bottom) to rows top first.

    Blender and Crucible agree on where the image faces once Crucible loads an HDRI (src/environment-orientation.js turns
    it a quarter of the width), so the add-on writes the rows as Blender has them and does not turn them itself (#1371)."""
    return linear_rgb_bottom_first[::-1]


def classify_color_space(name):
    """'srgb', 'linear', or None for a colour space Cook has no decoder for (the caller reports it)."""
    lowered = name.lower()
    if lowered == "srgb" or lowered.startswith("srgb "):
        return "srgb"
    if lowered in ("non-color", "raw") or lowered.startswith("linear") or lowered.startswith("scene linear"):
        return "linear"
    return None


def srgb_to_linear(encoded):
    import numpy

    return numpy.where(encoded <= 0.04045, encoded / 12.92, ((encoded + 0.055) / 1.055) ** 2.4)


def luminance(rgb):
    return sum(weight * channel for weight, channel in zip(LUMINANCE_WEIGHTS, rgb))


def note_once(notes_by_name, name, text):
    """Adds `text` to the notes of `name` unless it is already there, so a log line appears once per material."""
    notes = notes_by_name.setdefault(name, [])
    if text not in notes:
        notes.append(text)
