export function requestShiftLocation(geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined, secure: boolean): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!secure || !geolocation) {
      reject(new Error('A localização exige HTTPS e um navegador compatível.'));
      return;
    }
    geolocation.getCurrentPosition(
      position => resolve(position.coords),
      failure => reject(new Error(failure.code === 1
        ? 'A localização foi recusada. Permita o acesso nas configurações do navegador para tentar novamente.'
        : failure.code === 3 ? 'A localização demorou para responder. Tente novamente.'
          : 'A localização está indisponível. Verifique o GPS do dispositivo.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
    );
  });
}
