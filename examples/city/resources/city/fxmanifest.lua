fx_version 'cerulean'
game 'gta5'

description 'Who lives in the city, and their money'

server_scripts { '@oxmysql/lib/MySQL.lua', 'server.lua' }
client_script 'client.lua'

ui_page 'html/index.html'
file 'html/index.html'
