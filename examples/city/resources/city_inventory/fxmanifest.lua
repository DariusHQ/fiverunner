fx_version 'cerulean'
game 'gta5'

description 'What citizens carry, and the shop that sells it'

dependency 'city'

server_scripts { '@oxmysql/lib/MySQL.lua', 'server.lua' }
client_script 'client.lua'

ui_page 'html/index.html'
file 'html/index.html'
