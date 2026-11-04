const {isIPv4}=require('node:net');
function isPrivateVirtualIp(ip){
  if(typeof ip!=='string'||!isIPv4(ip))return false;
  const [a,b]=ip.split('.').map(Number);
  return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
module.exports={isPrivateVirtualIp};
