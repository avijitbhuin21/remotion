import {AbsoluteFill, Composition} from 'remotion';

type MyCompProps = {
	title: string;
};

const MyComp: React.FC<MyCompProps> = ({title}) => {
	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#000',
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
			<h1 style={{color: '#fff', fontFamily: 'sans-serif'}}>{title}</h1>
		</AbsoluteFill>
	);
};

export const RemotionRoot: React.FC = () => {
	return (
		<>
			<Composition
				id="MyComp"
				component={MyComp}
				durationInFrames={150}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={{
					title: 'Hello World',
				}}
			/>
		</>
	);
};
