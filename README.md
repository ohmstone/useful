# useful

Instructional design tool optimized for self-hosted websites leveraging AI
tools.

Main repo: [useful](https://github.com/ohmstone/useful).

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

## TODO

(not exhaustive, actively modified)

- [x] Server and config setup for running system as a web app
- [x] Web app based configuration and project creation
- [x] Local TTS and audio editor for voiceover of content
- [x] Voiceover and slide (and animation) alignment tool
- [x] Tools for turning structured content into slides
- [x] Process for publishing content as website
- [ ] Process for converting course into videos
- [ ] Documentation on how to use (preferably created with _useful_)
- [ ] Tools for creating optional interactive quizes
- [ ] Rich text editor for fleshing out initial draft course
- [ ] Tools for converting draft into a structured course
- [ ] Archive export / import format for editing and playback

## Potential tools

- [pocket tts](https://github.com/kyutai-labs/pocket-tts?tab=readme-ov-file)
- [ollama](https://ollama.com/)

## Contributing

This project is in initial stages. If you find this and want to help, I'd prefer
PRs over issues. Feel free to reach out anytime to github@tonelord.cc.
