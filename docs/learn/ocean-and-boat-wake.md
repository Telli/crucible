# Ocean and boat wake

![A fishing boat under way through ocean waves, with a wake of foam behind it](/previews/feature-ocean-wake.webp)

The `ocean` mesh edit draws a sea, and a crate or a boat that you mark as floating rides its waves. The picture is one frame of the boat scene, rendered by Crucible through the MCP render job.

- Draw the sea with the `ocean` stack operation (wind speed, choppiness, size, seed, resolution). See [mesh editing](/mesh.md).
- Mark the floating bodies and give the section a sea. See [Floating on the ocean](/physics.md#floating-on-the-ocean) and [Boats and wakes](/physics.md#boats-and-wakes).
- Animate `oceanTime` to move the waves between frames.
