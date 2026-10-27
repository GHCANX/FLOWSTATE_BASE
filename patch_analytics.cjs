const fs = require('fs');

const file = 'src/query/analyticsService.js';
const contents = fs.readFileSync(file, 'utf8');

const updated = contents.replace(
  "if (games.length === 0) return '';",
  "if (games.length === 0) return 'game_id,start_at,duration_seconds,stage_id,winner_port,player_index,port,character_id,connect_code,is_winner,l_cancel_rate,wavedash_count,dash_dance_turns,shield_drops,crouch_cancels,avg_galint_frames,ledgedash_count,ipm,openings_per_kill,damage_per_opening,total_damage_dealt';"
);

fs.writeFileSync(file, updated);
