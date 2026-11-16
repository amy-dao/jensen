# Jensen Rush

A 3-lane runner in the browser. Play it with the **keyboard**, or with **your whole body** through the webcam.

## Run locally

```bash
npx serve .
```


## Controls

| Action | Keyboard | Camera |
| --- | --- | --- |
| Change lane | ← / A, → / D | Step left / right |
| Get past an obstacle | Switch lanes | Switch lanes |
| Jump (when enabled) | ↑ / W / Space | Jump |
| Duck (when enabled) | ↓ / S (lasts 0.7 s) | Crouch (held) |

Right now jumping and ducking are switched off (`moves: { jump: false, duck: false }` in `src/config.js`), so every obstacle blocks its lane and you dodge by switching lanes. 

Run through the green **GPU** cards to collect them. Survive the full 20 s to reach the finish line. On the end screen, Enter or Space retries and Esc returns to the menu. Avoid distractions!!!!!!
