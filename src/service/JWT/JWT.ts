// import { jwtConstants } from '../../route/auth/constants/constants';
// import { JwtService } from '@nestjs/jwt';
//
// export class JWT {
//   constructor(private jwtService: JwtService) {}
//   public generateJWT(payload: string) {
//     return {
//       accessToken: this.jwtService.sign(payload, {
//         secret: jwtConstants.secret,
//         expiresIn: '24h',
//       }),
//       refreshToken: this.jwtService.sign(payload, {
//         secret: jwtConstants.secret,
//         expiresIn: '100h',
//       }),
//     };
//   }
// }
