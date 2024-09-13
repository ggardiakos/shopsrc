import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Settings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string;

  @Column('json')
  value: any;

  // Add any other relevant fields here
}