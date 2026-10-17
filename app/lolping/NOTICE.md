# lolPing integration

Source: https://github.com/darrenprx/lolPing
Commit: 2b8cdcb725738cdc4c112b35d06996c438fcc295
Version: 0.5.2

The vendored source retains its MIT license in vendor/LICENSE. Ping/emote artwork and sounds are © Riot Games and are not covered by the MIT license. lolPing and ScreenSh are not endorsed by Riot Games.

ScreenSh reuses the input helper, overlay, original room/text/vote renderers and styles, ready-check videos/audio, key mapping, text parsing and vote tally. Room data uses direct, encrypted UDP bound to the EasyTier interface; ScreenSh's authenticated channel server supplies membership, temporary ports and session public keys only. It does not relay content. ScreenSh disables lolPing's independent updater, room codes, startup and tray, and stores settings locally per server. ScreenSh adapts window lifecycle/IPC and provides its own wheel settings editor; custom imported emotes remain unavailable. Overlay listener cleanup and renderer failure notifications are adapted for starting and stopping with channel membership.
