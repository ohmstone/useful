# Slide Language Reference

This document describes the slide content language used in `useful`.
It is designed to be readable by both humans and LLMs generating slide content.

---

## Structure

A slide file (slides.txt) is a plain text file. Slides are separated by `===` lines:

```
=== <seconds>
Slide content here.

=== <seconds>
Next slide content here.
```

The number after `===` is the slide duration in seconds. Decimals are supported (`=== 2.5`).
Everything between two `===` markers is the content of one slide.

---

## Slide-level directives

Directives start with `@` and appear anywhere in the slide body (typically at the top).

### `@header`

Adds a slim header bar at the top of the slide with a left and right section:

```
@header Course Title | Module 3
```

Both sides support inline formatting. The `|` divides left from right.
Either side can be omitted:

```
@header Just a left title |
@header | Right side only
```

### `@bg`

Sets the slide background. Accepts any CSS color value:

```
@bg #1a1a2e
@bg navy
@bg rgba(20, 30, 60, 0.95)
@bg linear-gradient(135deg, #1a1a2e, #16213e)
```

Text color is automatically chosen (black or white) based on background luminance.
For gradients, white text is always used.

---

## Text content

### Headings

```
# Large heading
## Smaller sub-heading
```

### Paragraphs

Regular text. Consecutive lines form one paragraph; a blank line ends it.

```
This is the first sentence of a paragraph.
This continues on the same paragraph.

This is a new paragraph after the blank line.
```

### Inline formatting

Works inside paragraphs, headings, and list items:

| Syntax | Result |
|--------|--------|
| `**bold text**` | **Bold** |
| `*italic text*` | *Italic* |
| `__underlined text__` | Underlined |

These can be combined: `**__bold underline__**`

---

## Style hints

A `{options}` line on its own line applies styling to the **next** block (paragraph, heading, list, or image).

### Size

```
{big}
This paragraph will be displayed larger than normal.

{small}
This text will appear smaller.
```

Available sizes: `big`, `normal` (default), `small`

### Alignment

```
{center}
This text is centered.

{right}
Right-aligned text.
```

Available alignments: `left` (default), `center`, `right`

### Text color

```
{color:white}
This text will be white regardless of background.

{color:#aaddff}
Light blue text.
```

### Combining options

```
{big center}
Big and centered.

{small right color:#888}
Small, right-aligned, grey text.
```

---

## Lists

### Unordered list

```
- First item
- Second item
- Third item
```

Also works with `*`:

```
* Bullet one
* Bullet two
```

### Ordered list

```
1. First step
2. Second step
3. Third step
```

Any number works (the display order is what matters):

```
1. First
1. Second
1. Third
```

Style hints work on lists:

```
{big center}
- Important point
- Another key idea
```

---

## Images

Images are placed with the `@image` directive. The file must be in `_inject/` in your project folder (upload it via the **Files** button):

```
@image hero.jpg cover
@image diagram.png contain
@image "team photo.jpg" cover
```

**Fit options** (CSS `object-fit`):

| Option | Behavior |
|--------|----------|
| `contain` | Show the whole image, letterboxed (default) |
| `cover` | Fill the area, crop if needed |
| `fill` | Stretch to fill, ignoring aspect ratio |
| `none` | Natural size, no scaling |

The image always occupies the remaining vertical space on the slide. Quote filenames that contain spaces.

---

## Code blocks

Use triple backticks with an optional language name:

````
```python
def hello(name):
    return f"Hello, {name}!"
```
````

````
```javascript
const greet = name => `Hello, ${name}!`;
```
````

The language name is for display; no syntax highlighting is applied in the current renderer.

---

## Two-column layout

```
@columns 40
Left column content (40% wide).

# A heading on the left
- list item
- another item

@col
Right column content (60% wide, automatically).

@image photo.jpg contain

@end
```

- The number after `@columns` is the width of the **first** column in percent.
  The second column gets the remainder.
- Omit the number for equal 50/50 columns: `@columns`
- Each column can have its own background: put `@bg color` inside the column.
- Use `@col` to start the second column. `@end:col` (or just `@end`) closes the layout.

**Example with column backgrounds:**

```
@columns 35
@bg #1a1a2e
# Key Point
This is the left column with a dark blue background.

@col
@bg #0d2137
The right column has its own background.
Text color is set automatically for legibility.

@end:col
```

---

## Emphasis (timed spotlight)

An emphasis block dims all other slide content and highlights the enclosed blocks at a specific time:

```
@emph 2 3
This content is spotlighted starting at second 2, for 3 seconds.
All other content on the slide fades to very low opacity during this window.
@end:emph
```

Syntax: `@emph <start-seconds> <duration-seconds>`

- During editing, emphasis blocks are shown with a visual indicator (yellow left border + timing label).
- During playback, the spotlight effect is applied in real time.
- Multiple `@emph` blocks on one slide are allowed; only the currently active one highlights.

**Example:**

```
=== 12
# The three principles

- Simplicity
- Clarity
- Focus

@emph 0 4
- Simplicity
@end

@emph 4 4
- Clarity
@end

@emph 8 4
- Focus
@end
```

---

## Plugin (external JS content)

Embeds dynamic content from a JavaScript module. The plugin fills the available space on the slide
and controls its own visibility based on the slide time:

```
@plugin chart.js
```

With a data file:

```
@plugin chart.js data.json
```

Syntax: `@plugin <js-file> [data-file]`

- `js-file` is a `.js` module in `_inject/` in your project folder.
- `data-file` (optional) is the default data file passed to the function as `dataFn`.
- When playback reaches this slide, the plugin function is called once to set up its content.
- The plugin occupies the remaining vertical space on the slide.
- **Filenames with spaces** must be quoted: `@plugin "my chart.js" "sales data.json"`

### The plugin function contract

```javascript
// _inject/my-chart.js
export default function(inFn, outFn, dataFn) {
  // Create your root element and hand it to the slide once:
  const el = document.createElement('div');
  outFn(el);

  // Then animate using requestAnimationFrame. Poll inFn() for current time.
  // Check el.isConnected to know when the slide has changed — stop then.
  function tick() {
    if (!el.isConnected) return;
    const { width, height, timeInSlide, remaining } = inFn();
    //   width       — slot width in canvas pixels (1920×1080 space)
    //   height      — slot height in canvas pixels
    //   timeInSlide — seconds elapsed since the slide started
    //   remaining   — seconds left in the slide

    // Update el as needed. Hide/show based on timeInSlide if you want.
    el.style.opacity = timeInSlide > 2 ? '1' : '0';

    requestAnimationFrame(tick);
  }
  tick();

  // dataFn is provided when a data file is specified in @plugin.
  // dataFn()            → fetch Response for the default data file
  // dataFn("other.bin") → fetch Response for any named file in _inject/
  // Call .text(), .json(), .arrayBuffer(), .blob(), etc. on the Response.
  if (dataFn) {
    dataFn().then(r => r.json()).then(data => { el.textContent = data?.label ?? ''; });
  }
}
```

**Image example** (loading an image from `_inject/`):

```javascript
export default function(inFn, outFn, dataFn) {
  if (!dataFn) return;
  dataFn().then(r => r.blob()).then(blob => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.style.cssText = 'width:100%;height:100%;object-fit:contain';
    outFn(img);
  });
}
```

The plugin output is clipped to the allocated area. If it overflows, the overflow is hidden.

During editing (not in playback), plugin blocks show a subtle placeholder with the filename.

### Managing plugin files

Use the **Files** button in the module editor nav bar to upload, view, and delete files in `_inject/`.
You can also place files there manually — they are served from `GET /api/inject/:file`.

---

## Complete example

```
=== 8
@header Introduction to Parsing | Lesson 2
@bg linear-gradient(160deg, #0d1b2a, #1b263b)

# What is a parser?

A parser reads **structured text** and converts it into a
form that a computer can work with — typically a tree.

=== 6
@bg #12121a

{center}
## The three phases

{big center}
1. Tokenise
2. Parse
3. Evaluate

=== 10

@columns 45
@bg #1a1a2e

# Input

```text
=== 5
Hello, **world**!
```

@col
@bg #0d2137

# Output

```json
{ "type": "bold",
  "children": [
    { "type": "text",
      "text": "world" }
  ]
}
```

@end

=== 8
@bg #0d0d0f

{big center}
The key insight:

{center}
__Structure is just pattern recognition.__

@emph 3 5
{big center}
__Structure is just pattern recognition.__
@end

=== 6
@bg #12121a
@header Summary |

- Parsers convert text to structure
- Structure enables reasoning
- *Simplicity* matters for maintainability

@plugin timeline.js
```

---

## Tips for LLM-generated content

- One clear idea per slide. Keep text short.
- Use `{big center}` for a single key statement on its own slide.
- Use `@columns` when comparing two things side by side.
- Use `@emph` sparingly — one emphasis window per slide is usually enough.
- Headings (`# text`) are large; use them for the main point. Use `## text` for supporting structure.
- Code blocks should show only the essential lines. Less is more on slides.
- Always close `@columns` and `@emph` blocks with `@end`.
- The `|` in `@header` is required to separate left from right, even if one side is empty.
