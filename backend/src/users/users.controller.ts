import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersService } from './users.service';
import { LdapSearchService, LdapUserEntry } from './ldap-search.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from './entities/user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly ldapSearchService: LdapSearchService,
  ) {}

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

  @Get('search')
  async searchUsers(
    @Request() req: { user: User },
    @Query('q') q: string,
  ) {
    if (!q || q.trim().length < 2) return [];
    const query = q.trim();

    // Run DB and LDAP search in parallel
    const [dbUsers, ldapEntries] = await Promise.all([
      this.usersService.search(query, req.user.id),
      this.ldapSearchService.search(query).catch((): LdapUserEntry[] => []),
    ]);

    const dbUsernames = new Set(dbUsers.map((u) => u.username.toLowerCase()));

    // LDAP-only users: in LDAP but not yet in local DB
    const ldapOnly = ldapEntries
      .filter((e) => !dbUsernames.has(e.username.toLowerCase()) && e.username !== req.user.username)
      .slice(0, 10);

    const dbResults = dbUsers.map((u) => ({
      id: u.id,
      displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || u.username,
      username: u.username,
      avatar: u.avatar ?? undefined,
      fromLdap: false,
    }));

    const ldapResults = ldapOnly.map((e) => ({
      id: null as string | null,
      displayName: e.displayName,
      username: e.username,
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email,
      avatar: undefined,
      fromLdap: true,
    }));

    return [...dbResults, ...ldapResults];
  }

  @Post('ensure')
  async ensureUser(
    @Body() dto: { username: string; displayName: string; firstName?: string; lastName?: string; email?: string },
  ) {
    let user = await this.usersService.findByUsername(dto.username);
    if (!user) {
      user = await this.usersService.createStub(dto);
    }
    return {
      id: user.id,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username,
      avatar: user.avatar ?? undefined,
    };
  }

  @Get(':id/avatar')
  @Public()
  async getAvatar(@Param('id') id: string, @Res() res: Response) {
    const user = await this.usersService.findById(id);
    const match = user?.avatar?.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new NotFoundException();
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buffer);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
