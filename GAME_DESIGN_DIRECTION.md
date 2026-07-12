# Bridge Crew Game Design Direction

Bridge Crew is a digital game designed as a shared experience for two or more co-located players. Players take the role of officers on the bridge of a spaceship. Players take a seat at consoles or stations controlling various ship functions. Each player is responsible for the functions tied to their console, and must work together to accomplish missions. Consoles have a variety of widgets to control systems and sell the fiction of spaceship control panel. The design encourages one player to serve as the captain. In an ideal game the captain does not have their own console. They maintain situational awareness of the mission as a whole and provide directions to coordinate the actions of other players. The captain's "console" is the main display which is visible to and shared by all players.

This document is not a comprehensive implementation guideline. Those documents are found in the docs/design folder. This document is overall guidance for the player experience. When Claude is making changes in auto mode, any decisions should be made with this general guidance in mind. Claude is free to propose alternate creative approaches for my approval before implementing.

## Design pillars

1. Every player contributes to success, and players of varied skill levels can be part of the same crew.
2. Cooperation is essential to executing a mission well.
3. Strategic thinking, situational awareness, and console management are prioritized over reflexes or dexterity.

## Aesthetic guidance

The tone is hopeful, professional, cinematic, disciplined, measured, ceremonious, and high-stakes.

The game should adhere to the following aesthetic guidance:
- Graphics are stylized rather than photorealistic.
- Clean and futuristic look for elements of the ship.
- Graphical detail, fidelity, and game "chrome" or "juice" is desired, but visual noise, clutter, or "greebles" are not.
- Sparse, ambient background music.
- Diegetic sound effects (sound of a breaker flipping, damage warning, laser firing, engines humming, etc.).

## Real-world user experience

Every player plays the game from their own device -- phone, tablet, or computer -- which serves as their ship console. They are gathered around a shared screen like a TV which serves as the main window looking out of the bridge. A wide mix of roles and choices should be supported. Each player should feel vital. Players of different skill levels should be able to serve on the same crew via per-player difficulty settings.

Each console should provide an engaging experience on its own. Consoles should have a mix of nuanced gameplay opportunities -- some widgets that require decision-making, strategy, and foresight, as well as widgets that are always optimal in some situations. While each console should provide a satisfying experience, the full experience comes through most clearly when working with a human crew.

Missions should provide a range of gameplay experiences, from mechanics-first missions that exercise console skill, to narrative-first experiences that emphasize thematics. Typical missions should have strong elements of both.

Players should be able to opt-out of some parts of the complexity of the experience.

## In-game Structure

The game is structured around missions which the players must complete by working together. Missions have objectives which must be accomplished as well as incidental obstacles which must be overcome. Non-binary win conditions are supported. Missions can be authored or procedurally generated.

Empty player consoles are filled by computer players which play slowly and subopimally but which still enable players at the other consoles to accomplish mission objectives.