# lua-3p-language-servers

Opinionated 3rd party Language Servers wrappers for Lua tools that do not currently provide language servers.

Provides 2 language servers:

* **selene-3p-language-server** - wrapper for [Selene](https://github.com/Kampfkarren/selene) Lua linter. Provides diagnostics.
* **stylua-3p-language-server** - wrapper for [Stylua](https://github.com/JohnnyMorganz/StyLua) Lua formatter. Provides full document and range formatting.

## Install

```bash
npm install --global lua-3p-language-servers
```

Selene and Stylua must be installed and available in your PATH. See their documentation for installation instructions.

## Usage with Neovim

To use with [neovim/nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) add the following files

```lua
-- lua/lspconfig/configs/selene3p_ls.lua
local util = require('lspconfig.util')

return {
    default_config = {
        cmd = { 'selene-3p-language-server' },
        filetypes = { 'lua' },
        root_dir = util.root_pattern('selene.toml'),
    },
}
```

```lua
-- lua/lspconfig/configs/stylua3p_ls.lua
local util = require('lspconfig.util')

return {
    default_config = {
        cmd = { 'stylua-3p-language-server' },
        filetypes = { 'lua' },
        root_dir = util.root_pattern('.stylua.toml'),
    },
}
```
