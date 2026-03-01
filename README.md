# Oscar-Bot

A simple, modular Discord bot powered by **discord.js** featuring persistent polls and slash command interactions.

---

## Features

* Slash Commands
* Interactive Poll System
* Persistent Poll Storage
* Automatic Poll Recovery
* Modular Command Structure

---

## Demo Features

| Feature        | Description                        |
| -------------- | ---------------------------------- |
| Slash Commands | Modern Discord interaction support |
| Polls          | Create and vote using select menus |
| Persistence    | Polls remain after restart         |
| Modular Design | Easy command expansion             |

---

## Getting Started

### 1. Clone Repository

```bash
git clone https://github.com/MicheaBoab/Oscar-Bot.git
cd Oscar-Bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Create `.env`:

```
DISCORD_TOKEN=YOUR_TOKEN
CLIENT_ID=YOUR_CLIENT_ID
GUILD_ID=YOUR_GUILD_ID
```

---

## Register Commands

```bash
node deploy-commands.js
```

---

## Run

```bash
node index.js
```

---

---

## Adding Commands

1. Create a new file inside `commands/`
2. Export command data + execute function
3. Redeploy commands

---

## Contributing

Contributions are welcome.

1. Fork repository
2. Create feature branch
3. Commit changes
4. Open Pull Request

---

## Roadmap

* [ ] Multi-guild support
* [ ] Database backend option
* [ ] Permission system
* [ ] Admin utilities

---

## License

MIT License
