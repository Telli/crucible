# Bake light

![A room lit by one lamp, with red and green walls tinting the light that bounces off them](/previews/feature-baked-room.webp)

`crucible/addons/light-bake` writes the light that bounces between surfaces into one lightmap texture per part. Recipes reach it through the `bake` section, so an agent can bake without code. The picture is a room with one point light: the walls tint the light that reaches the floor, the block and the ball.

- Presets, bounce counts and limits: [Light bake](/light-bake.md).
- Without a bake, the realtime lights and sky are in [Effects and lighting](#effects-and-lighting).
