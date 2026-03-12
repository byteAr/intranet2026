import { Body, Controller, Get, Param, Patch, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from './entities/user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Request() req: { user: User }) {
    return this.usersService.findById(req.user.id);
  }

  @Patch('me')
  updateMe(
    @Request() req: { user: User },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
