# useful

Instructional design tool optimized for self-hosted websites leveraging AI.

[**Try useful examples here!**](https://tonelord.codeberg.page/useful-course-examples/)

[Codeberg Main Repo](https://codeberg.org/ohmstone/useful).

[Github Mirror](https://github.com/ohmstone/useful).

## Requirements

To run this on your machine you will need:

- To use Linux environment
  - Untested on Mac or Windows
  - Use [Docker](https://www.docker.com/) if it helps
- [Git](https://git-scm.com/)
- [Denolang](https://deno.com/)
- [FFmpeg](https://ffmpeg.org/)

## Setup

- Install the requirements
- Open the project in a terminal
- Clone with submodules

```bash
git clone --recurse-submodules https://codeberg.org/ohmstone/useful.git
```

- Run the app

```bash
deno task serve
```

- Go to the URL it displays in the terminal

### Setup note

This project has been designed specifically for use with an LLM coding agent.
Your ability to adapt this project to your setup can be augmented by the use
of one, and is recommended.

### Recommended

For serving exported courses in production, it is recommended to use:

- [Caddy](https://caddyserver.com/): as a web server
  - Use strict CSP rules, for example:
    ```nginx
    header {
      Content-Security-Policy "default-src 'self'; style-src 'self'; worker-src 'self' blob:; script-src 'self'; img-src 'self' data:; frame-src; connect-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; media-src blob: 'self';"
      Referrer-Policy "strict-origin-when-cross-origin"
      Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
      X-Content-Type-Options "nosniff"
    }
    ```
- [Brotli](https://github.com/google/brotli): for text compression
- AVIF: for optimised images

## TODO

(not exhaustive, actively modified)

- [x] Server and config setup for running system as a web app
- [x] Web app based configuration and project creation
- [x] Local TTS and audio editor for voiceover of content
- [x] Voiceover and slide (and animation) alignment tool
- [x] Tools for turning structured content into slides
- [x] Process for publishing content as website
- [ ] Documentation on how to use (preferably created with _useful_)
- [ ] Tools for creating optional interactive quizes + more plugins
- [ ] Process for converting course into videos
- [ ] Creating voices for cloning, cleaning input/output audio
- [ ] Rich text editor for fleshing out initial draft course
- [ ] Tools for converting draft into a structured course
- [ ] Archive export / import format for editing and playback
- [ ] Hybrid app export

## Tools used

- Deno
- FFmpeg
- [pocket tts](https://github.com/kyutai-labs/pocket-tts?tab=readme-ov-file)

## Potential tools

- [ollama](https://ollama.com/)

## Contributing

This project is in initial stages. If you find this and want to help, I'd prefer
PRs over issues. Feel free to reach out anytime to github@tonelord.cc.

## Goal

Build a minimal tool to help create low-bandwidth instructional courses.

## Motivation

I intend to create some instructional content for my repos. I found that much
instructional content follows a standard structure. LLMs can help clean up and
organise the content to follow this structure. TTS is good enough now to produce
decent quality voiceover. By designing this as: content in slides that tracks
against the progress of audio, then you have a very low bandwidth alternative to
videos. Thiis means it can be a self-hosted website. It can also be rendered to
video, in case you want to share that instead.

Much of the ideas for this are based upon some earlier prototyping I did. What I
learned is that the users need full control over the actual content, alignment
and editing of audio with visuals, and a clear process for structuring it all.
These experiments were well before local GenAI was an option, so hopefully we
can leverage these advances today and not entirely depend on remote tools.

The current name was chosen because I want to build something _useful_.

## License

MIT
