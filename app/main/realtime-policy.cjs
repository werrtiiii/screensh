// Voice must keep its scheduling priority when the user switches to the
// application being shared. backgroundThrottling:false alone only covers Blink.
function configureRealtimeScheduling(commandLine) {
  for (const flag of ['disable-renderer-backgrounding','disable-background-timer-throttling','disable-backgrounding-occluded-windows']) commandLine.appendSwitch(flag);
  const features=new Set((commandLine.getSwitchValue?.('disable-features')||'').split(',').filter(Boolean));
  for(const feature of ['WebRtcHideLocalIpsWithMdns','CalculateNativeWinOcclusion','UseEcoQoSForBackgroundProcess'])features.add(feature);
  commandLine.appendSwitch('disable-features',[...features].join(','));
}
module.exports={configureRealtimeScheduling};
